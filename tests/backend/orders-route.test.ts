import { describe, expect, test } from 'bun:test';
import {
  buildManualPurchasePayment,
  buildManualPurchaseWebhookBody,
  validateCheckoutRequiredFields,
} from '../../lib/routes/orders';
import type { CheckoutPayload } from '../../lib/types/checkout';

const validPayload: CheckoutPayload = {
  locale: 'uk',
  payment_type: 'no_prepayment',
  amount: 0,
  cart_total: 2590,
  cart_token: 'cart-token',
  customer: {
    first_name: 'Анастасія',
    last_name: 'Зінчук',
    phone: '+380682345729',
    email: 'test@example.com',
  },
  shipping_type: 'ukraine',
  shipping: {
    type: 'ukraine',
    delivery_method: 'branch',
    city: 'Київ',
    city_ref: 'city-ref',
    warehouse: 'Відділення №12',
    warehouse_ref: 'warehouse-ref',
  },
  goods: [
    {
      variant_id: 111,
      name: 'Костюм',
      price: 2590,
      quantity: 1,
    },
  ],
  comment: 'Тест',
  personal_data_consent: true,
  tracking: {
    page_url: 'https://okolo-ua.com/pages/checkkout',
    ga_client_id: '123456789.1788445000',
    ga_session_id: '1788445000',
    gclid: 'test-gclid-123',
  },
  utm: {
    utm_source: 'google',
    utm_medium: 'cpc',
  },
};

describe('orders route validation', () => {
  test('accepts a complete checkout payload', () => {
    expect(validateCheckoutRequiredFields(validPayload)).toEqual([]);
  });

  test('rejects payloads without required customer and cart data', () => {
    const missing = validateCheckoutRequiredFields({
      ...validPayload,
      customer: {
        first_name: '',
        last_name: '',
        phone: '',
        email: '',
      },
      goods: [],
      personal_data_consent: false,
    });

    expect(missing).toContain("ім'я та прізвище");
    expect(missing).toContain('телефон');
    expect(missing).toContain('товари в кошику');
    expect(missing).toContain('згода на обробку персональних даних');
  });

  test('rejects domestic delivery without selected branch or postomat', () => {
    expect(validateCheckoutRequiredFields({
      ...validPayload,
      shipping: {
        ...validPayload.shipping,
        delivery_method: 'branch',
        warehouse: '',
      },
    })).toContain('відділення Нової пошти');

    expect(validateCheckoutRequiredFields({
      ...validPayload,
      shipping: {
        ...validPayload.shipping,
        delivery_method: 'postomat',
        warehouse: '',
      },
    })).toContain('поштомат Нової пошти');
  });

  test('builds manual-order purchase metadata with tracking data', () => {
    const payment = buildManualPurchasePayment(validPayload, { id: 7243745919168, name: '#1486' }, 0);
    const webhookBody = buildManualPurchaseWebhookBody(payment);

    expect(payment).toMatchObject({
      shopifyOrderId: 7243745919168,
      shopifyOrderName: '#1486',
      reference: 'shopify-7243745919168',
      amount: 0,
      paymentType: 'no_prepayment',
      cartTotal: 2590,
      tracking: {
        utm_source: 'google',
        utm_medium: 'cpc',
        ga_client_id: '123456789.1788445000',
        ga_session_id: '1788445000',
        gclid: 'test-gclid-123',
      },
    });
    expect(webhookBody).toMatchObject({
      invoiceId: 'shopify-7243745919168',
      status: 'success',
      reference: 'shopify-7243745919168',
      amount: 259000,
      finalAmount: 259000,
      paymentInfo: {
        source: 'manual_checkout',
      },
    });
  });
});
