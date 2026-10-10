import { env } from '../config/env';
import { json } from '../http/responses';
import {
  createShopifyOrder,
  getCartTotal,
  getPaymentAmount,
} from '../services/shopify/shopify-order';
import { sendSitniksOrder } from '../services/sitniks/sitniks-order';
import { sendServerSidePurchaseEvents } from '../services/tracking/purchase';
import { checkoutPayloadSchema, type CheckoutPayload, type StoredPaymentMetadata } from '../types/checkout';
import type { MonobankWebhookBody } from '../types/monobank';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function phoneDigits(value: unknown): string {
  return text(value).replace(/\D/g, '');
}

export function buildManualPurchasePayment(
  body: CheckoutPayload,
  shopifyOrder: { id: number; name?: string },
  amount: number,
): StoredPaymentMetadata {
  const tracking = {
    ...(body.utm || {}),
    ...(body.tracking || {}),
  };
  const cartTotal = getCartTotal(body) || amount;

  return {
    shopifyOrderId: shopifyOrder.id,
    shopifyOrderName: shopifyOrder.name,
    reference: `shopify-${shopifyOrder.id}`,
    amount,
    paymentType: body.payment_type,
    customer: body.customer,
    tracking,
    cartTotal,
    goods: body.goods,
  };
}

export function buildManualPurchaseWebhookBody(payment: StoredPaymentMetadata): MonobankWebhookBody {
  const eventAmount = Math.round((payment.cartTotal || payment.amount || 0) * 100);

  return {
    invoiceId: payment.reference,
    status: 'success',
    reference: payment.reference,
    amount: eventAmount,
    finalAmount: eventAmount,
    modifiedDate: new Date().toISOString(),
    paymentInfo: {
      source: 'manual_checkout',
    },
  };
}

export function validateCheckoutRequiredFields(body: CheckoutPayload): string[] {
  const customer = body.customer || {};
  const shipping = body.shipping || {};
  const missing: string[] = [];
  const customerName = [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(' ');
  const hasGoods = (body.goods || []).some((item) => {
    const quantity = Number(item.quantity || 0);
    return quantity > 0 && (text(item.variant_id) || text(item.code) || text(item.name) || text(item.title));
  });

  if (!customerName) missing.push("ім'я та прізвище");
  if (phoneDigits(customer.phone).length < 10) missing.push('телефон');
  if (!hasGoods) missing.push('товари в кошику');
  if (body.personal_data_consent !== true) missing.push('згода на обробку персональних даних');

  const isInternational = body.shipping_type === 'international' || shipping.type === 'international';
  if (isInternational) {
    if (!text(shipping.country)) missing.push('країна доставки');
    if (!text(shipping.intl_city) && !text(shipping.city)) missing.push('місто доставки');
    if (!text(shipping.address)) missing.push('адреса доставки');
  } else {
    const deliveryMethod = text(shipping.delivery_method) || 'branch';
    if (!text(shipping.city)) missing.push('місто Нової пошти');
    if (deliveryMethod === 'address') {
      if (!text(shipping.street)) missing.push('вулиця доставки');
      if (!text(shipping.house)) missing.push('будинок доставки');
    } else if (!text(shipping.warehouse)) {
      missing.push(deliveryMethod === 'postomat' ? 'поштомат Нової пошти' : 'відділення Нової пошти');
    }
  }

  return missing;
}

export async function handleCreateInvoice(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = checkoutPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    const isEmailError = parsed.error.issues.some((issue) => issue.path.join('.') === 'customer.email');

    return json({
      error: 'Invalid checkout payload',
      message: isEmailError ? 'Введіть коректний e-mail або залиште поле порожнім' : 'Перевірте дані форми',
      details: parsed.error.flatten(),
    }, 400);
  }

  const body = parsed.data;
  const requestUserAgent = request.headers.get('user-agent') || '';
  const requestPageUrl = request.headers.get('referer') || request.headers.get('origin') || '';
  const requestIp =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '';
  const rawTracking = {
    ...(body.utm || {}),
    ...(body.tracking || {}),
  };
  body.tracking = {
    ...rawTracking,
    user_agent: String(rawTracking.user_agent || requestUserAgent).trim(),
    page_url: String(rawTracking.page_url || requestPageUrl).trim(),
    client_ip_address: String(rawTracking.client_ip_address || requestIp).trim(),
  };

  const missingFields = validateCheckoutRequiredFields(body);
  if (missingFields.length > 0) {
    console.warn('[Orders] Rejected incomplete manual-payment order', {
      missingFields,
      hasGoods: (body.goods || []).length > 0,
      hasPhone: phoneDigits(body.customer?.phone).length >= 10,
      hasTracking: Object.keys(body.tracking || {}).length > 0,
    });

    return json({
      error: 'Invalid checkout payload',
      message: `Заповніть обов'язкові поля: ${missingFields.join(', ')}`,
      details: { missingFields },
    }, 400);
  }

  try {
    body.payment_type = body.payment_type === 'full' ? 'full' : 'no_prepayment';
    const amount = getPaymentAmount(body);
    const shopifyOrder = await createShopifyOrder(body, amount);
    void sendSitniksOrder(body, shopifyOrder).catch((error) => {
      console.error('[Sitniks] Failed to send manual-payment order:', error);
    });
    const purchasePayment = buildManualPurchasePayment(body, shopifyOrder, amount);
    const purchaseWebhookBody = buildManualPurchaseWebhookBody(purchasePayment);
    void sendServerSidePurchaseEvents(purchasePayment, purchaseWebhookBody).catch((error) => {
      console.error('[Tracking] Failed to send manual-payment purchase events:', error);
    });

    const isFullPayment = body.payment_type === 'full';

    return json({
      invoiceId: '',
      invoiceUrl: '',
      reference: `shopify-${shopifyOrder.id}`,
      amount,
      paymentType: body.payment_type,
      paymentFlow: isFullPayment ? 'manual_full_payment' : 'cash_on_delivery',
      message: isFullPayment
        ? 'Замовлення оформлено. Реквізити для оплати на наступній сторінці.'
        : 'Замовлення оформлено. Оплата при отриманні.',
      redirectUrl: env.redirectUrl,
      shopifyOrderId: shopifyOrder.id,
      shopifyOrderName: shopifyOrder.name,
    });
  } catch (error) {
    console.error('[Orders] Error creating manual-payment order:', error);
    return json({
      error: 'Failed to create order',
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

export async function handlePaymentOptions(): Promise<Response> {
  return json({
    cashOnDelivery: {
      enabled: true,
    },
    fullPayment: {
      enabled: true,
      type: 'manual',
    },
  });
}
