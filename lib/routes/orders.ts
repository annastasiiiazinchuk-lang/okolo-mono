import { env } from '../config/env';
import { json } from '../http/responses';
import {
  createShopifyOrder,
  getPaymentAmount,
} from '../services/shopify/shopify-order';
import { sendSitniksOrder } from '../services/sitniks/sitniks-order';
import { checkoutPayloadSchema } from '../types/checkout';

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
      message: isEmailError ? 'Введіть, будь ласка, e-mail' : 'Перевірте дані форми',
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

  try {
    body.payment_type = 'no_prepayment';
    const amount = getPaymentAmount(body);
    const shopifyOrder = await createShopifyOrder(body, amount);
    void sendSitniksOrder(body, shopifyOrder).catch((error) => {
      console.error('[Sitniks] Failed to send no-prepayment order:', error);
    });

    return json({
      invoiceId: '',
      invoiceUrl: '',
      reference: `shopify-${shopifyOrder.id}`,
      amount,
      paymentType: body.payment_type,
      paymentFlow: 'shopify_order',
      message: 'Замовлення оформлено. Оплата при отриманні.',
      redirectUrl: env.redirectUrl,
      shopifyOrderId: shopifyOrder.id,
      shopifyOrderName: shopifyOrder.name,
    });
  } catch (error) {
    console.error('[Orders] Error creating no-prepayment order:', error);
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
  });
}
