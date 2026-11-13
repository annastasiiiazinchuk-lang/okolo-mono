import { describe, expect, test } from 'bun:test';
import {
  buildOrderUpdateAfterPayment,
  buildPaidShopifyOrderPayload,
  buildShippingAddress,
  buildCustomerComment,
  buildShopifyOrderPayload,
  getPaymentAmount,
  getShippingPrice,
  normalizeShopifyPhone,
} from '../../lib/services/shopify/shopify-order';
import type { CheckoutPayload } from '../../lib/types/checkout';

const basePayload: CheckoutPayload = {
  locale: 'uk',
  payment_type: 'full',
  amount: 1200,
  cart_total: 1200,
  cart_token: 'cart-token',
  customer: {
    first_name: 'Анастасія',
    last_name: 'Зінчук',
    phone: '0682345729',
    email: 'test@example.com',
  },
  shipping_type: 'ukraine',
  shipping: {
    type: 'ukraine',
    delivery_method: 'branch',
    city: 'Київ',
    city_ref: 'city-ref-kyiv',
    warehouse: 'Відділення №12',
    warehouse_ref: 'warehouse-ref-12',
  },
  goods: [
    {
      variant_id: 111,
      name: 'Годинник',
      price: 1200,
      quantity: 1,
      properties: [
        {
          name: 'Текст для гравіювання на коробці',
          value: '1111',
        },
      ],
    },
  ],
  comment: '',
  personal_data_consent: true,
  tracking: {},
  utm: {},
};

describe('Shopify order mapping', () => {
  test('full payment amount equals cart total', () => {
    expect(getPaymentAmount(basePayload)).toBe(1200);
  });

  test('order keeps contact phone without creating Shopify customer', () => {
    const payload = buildShopifyOrderPayload(basePayload, getPaymentAmount(basePayload));

    expect(payload.order.email).toBe('test@example.com');
    expect(payload.order.phone).toBe('+380682345729');
    expect(payload.order.customer).toBeUndefined();
    expect(payload.order.shipping_address).toMatchObject({
      first_name: 'Анастасія',
      last_name: 'Зінчук',
      phone: '+380682345729',
    });
  });

  test('normalizes Ukrainian phone numbers for Shopify', () => {
    expect(normalizeShopifyPhone('380682345729')).toBe('+380682345729');
    expect(normalizeShopifyPhone('0682345729')).toBe('+380682345729');
    expect(normalizeShopifyPhone('+380 (68) 234-57-29')).toBe('+380682345729');
  });

  test('order additional details include payment and delivery fields for integrations', () => {
    const payload = buildShopifyOrderPayload(basePayload, getPaymentAmount(basePayload));

    expect(payload.order.tags).toBe('full_payment_unpaid');
    expect(String(payload.order.note)).toBe('');
    const commentAttribute = (payload.order.note_attributes as Array<{ name?: string; value?: string }>)
      .find((attribute) => attribute.name === 'Comment');
    expect(commentAttribute).toBeUndefined();
    const attributeNames = (payload.order.note_attributes as Array<{ name?: string }>).map((attribute) => attribute.name);
    expect(attributeNames).not.toEqual(expect.arrayContaining([
      'Recipient Name',
      'Recipient Phone',
      'Recipient Email',
      'City',
      'Post Office',
      'nova_poshta_city',
      'nova_poshta_warehouse',
      '_delivery_city',
      '_delivery_warehouse',
    ]));
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'payment_type', value: 'full_payment' },
      { name: 'shipping_type', value: 'ukraine' },
      { name: 'payment_status', value: 'unpaid' },
      { name: 'Сума', value: '1200' },
      { name: 'Сплата', value: '0' },
      { name: 'Paid amount', value: '0' },
      { name: 'Payment', value: 'Повна оплата' },
      { name: 'Payment tag', value: 'full_payment_unpaid' },
      { name: 'payment_tag', value: 'full_payment_unpaid' },
      { name: 'Payment status tag', value: 'full_payment_unpaid' },
      { name: 'Currency rate', value: '1' },
      { name: 'Cash on delivery', value: 'false' },
      { name: 'Checkout id', value: 'cart-token' },
    ]));
  });

  test('order additional details include UTM marks in Checkly-compatible field', () => {
    const payload = buildShopifyOrderPayload({
      ...basePayload,
      utm: {
        utm_source: 'ig',
        utm_medium: 'social',
      },
      tracking: {
        utm_campaign: 'fall',
        utm_content: 'link_in_bio',
        utm_term: 'midi',
        utm_lang: 'uk',
        utm_id: 'campaign-123',
        fbclid: 'fb-click-id',
        fbc: 'fb.1.17887050587983.fb-click-id',
        fbp: 'fb.1.17887050546561.847850575329279795',
        gclid: 'google-click-id',
      },
    }, getPaymentAmount(basePayload));
    const utmAttribute = (payload.order.note_attributes as Array<{ name?: string; value?: string }>)
      .find((attribute) => attribute.name === 'UTM');
    const commentAttribute = (payload.order.note_attributes as Array<{ name?: string; value?: string }>)
      .find((attribute) => attribute.name === 'Comment');

    expect(utmAttribute?.value).toContain('utm_medium: social');
    expect(utmAttribute?.value).toContain('utm_source: ig');
    expect(utmAttribute?.value).toContain('utm_campaign: fall');
    expect(utmAttribute?.value).toContain('utm_content: link_in_bio');
    expect(utmAttribute?.value).toContain('utm_term: midi');
    expect(utmAttribute?.value).toContain('fbclid: fb-click-id');
    expect(utmAttribute?.value).toContain('gclid: google-click-id');
    expect(utmAttribute?.value).toContain('_fbc: fb.1.17887050587983.fb-click-id');
    expect(utmAttribute?.value).toContain('_fbp: fb.1.17887050546561.847850575329279795');
    expect(utmAttribute?.value).toContain('utm_lang: uk');
    expect(utmAttribute?.value).toContain('utm_id: campaign-123');
    expect(String(payload.order.note)).toBe('');
    expect(commentAttribute).toBeUndefined();
  });

  test('formats Instagram product sync source with separate UTM lines', () => {
    const payload = buildShopifyOrderPayload({
      ...basePayload,
      comment: [
        'Передзвоніть перед відправкою',
        'Instagram/Telegram: ТЕСТ',
        'Як звʼязатись: Напишіть мені',
        'Доставка: Нова пошта (відділення), оплата доставки на пошті',
        'Спосіб оплати: Повна оплата',
        'ЗВІДКИ КЛІЄНТ',
        'Google',
      ].join('\n'),
      utm: {
        utm_source: 'google',
        utm_medium: 'product_sync',
        utm_campaign: 'sag_organic',
      },
      tracking: {
        traffic_source: 'Google',
        gclid: 'google-click-id',
      },
    }, getPaymentAmount(basePayload));
    const note = String(payload.order.note);
    const commentAttribute = (payload.order.note_attributes as Array<{ name?: string; value?: string }>)
      .find((attribute) => attribute.name === 'Comment');

    expect(note).toBe('Передзвоніть перед відправкою');
    expect(commentAttribute?.value).toBe('Передзвоніть перед відправкою');
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'Instagram/Telegram', value: 'ТЕСТ' },
      { name: 'Як зв\'язатись', value: 'Напишіть мені' },
      { name: 'UTM', value: expect.stringContaining('utm_campaign: sag_organic') },
    ]));
  });

  test('keeps only the free-text customer comment', () => {
    const body = {
      ...basePayload,
      comment: [
        'Мій коментар',
        'Instagram/Telegram: @okolo',
        'Як зв\'язатись: Напишіть мені',
        'Доставка: Нова пошта (відділення), оплата доставки на пошті',
        'Спосіб оплати: Післяплата',
        'Передплата: менеджер зв\'яжеться для проведення мінімальної передплати 200 грн',
        'ЗВІДКИ КЛІЄНТ',
        'Google',
      ].join('\n'),
    };

    expect(buildCustomerComment(body)).toBe('Мій коментар');
    const payload = buildShopifyOrderPayload(body, getPaymentAmount(body));
    expect(payload.order.note).toBe('Мій коментар');
  });

  test('custom checkout orders do not add Shopify taxes', () => {
    const payload = buildShopifyOrderPayload(basePayload, getPaymentAmount(basePayload));
    const lineItems = payload.order.line_items as Array<Record<string, unknown>>;

    expect(payload.order.tax_exempt).toBe(true);
    expect(payload.order.taxes_included).toBe(false);
    expect(lineItems[0].taxable).toBe(false);
    expect(lineItems[0].tax_lines).toEqual([]);
  });

  test('passes product engraving properties to Shopify line items', () => {
    const payload = buildShopifyOrderPayload(basePayload, getPaymentAmount(basePayload));
    const lineItems = payload.order.line_items as Array<Record<string, unknown>>;

    expect(lineItems[0].properties).toEqual([
      {
        name: 'Текст для гравіювання на коробці',
        value: '1111',
      },
    ]);
  });

  test('international delivery does not add extra shipping fee', () => {
    const internationalPayload: CheckoutPayload = {
      ...basePayload,
      amount: 1200,
      shipping_type: 'international',
      shipping: {
        type: 'international',
        country: 'Poland',
        intl_city: 'Warsaw',
        address: 'Main street 1',
        apartment: '2',
        postcode: '00-001',
        shipping_price: 660,
      },
    };
    const payload = buildShopifyOrderPayload(internationalPayload, getPaymentAmount(internationalPayload));
    const shippingAddress = payload.order.shipping_address as Record<string, unknown>;

    expect(getPaymentAmount(internationalPayload)).toBe(1200);
    expect(getShippingPrice(internationalPayload)).toBe(0);
    expect(payload.order.shipping_lines).toBeUndefined();
    expect(shippingAddress).toMatchObject({
      address1: 'Main street 1',
      address2: '2',
      city: 'Warsaw',
      country: 'Poland',
      zip: '00-001',
    });
    expect(String(payload.order.note)).toBe('');
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'shipping_type', value: 'international' },
      { name: 'Payment', value: 'Повна оплата' },
    ]));
  });

  test('prepayment amount is fixed at 300', () => {
    expect(getPaymentAmount({ ...basePayload, payment_type: 'prepayment' })).toBe(300);
  });

  test('installments payment amount equals cart total', () => {
    expect(getPaymentAmount({ ...basePayload, payment_type: 'installments' })).toBe(1200);
  });

  test('no-prepayment order starts pending without online paid amount', () => {
    const noPrepaymentPayload = { ...basePayload, payment_type: 'no_prepayment' as const, amount: 0 };
    const payload = buildShopifyOrderPayload(noPrepaymentPayload, getPaymentAmount(noPrepaymentPayload));

    expect(getPaymentAmount(noPrepaymentPayload)).toBe(0);
    expect(payload.order.financial_status).toBe('pending');
    expect(payload.order.tags).toBe('no_prepayment');
    expect(String(payload.order.note)).toBe('');
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'payment_type', value: 'no_prepayment' },
      { name: 'payment_status', value: 'unpaid' },
      { name: 'Payment', value: 'Накладений платіж' },
      { name: 'Payment tag', value: 'no_prepayment' },
      { name: 'payment_tag', value: 'no_prepayment' },
      { name: 'Cash on delivery', value: 'true' },
    ]));
  });

  test('prepayment order starts pending with not_paid_300 tag and no discount before payment', () => {
    const prepaymentPayload = { ...basePayload, payment_type: 'prepayment' as const };
    const payload = buildShopifyOrderPayload(prepaymentPayload, getPaymentAmount(prepaymentPayload));
    const lineItems = payload.order.line_items as Array<Record<string, unknown>>;

    expect(payload.order.financial_status).toBe('pending');
    expect(payload.order.tags).toBe('not_paid_300, prepayment_300_unpaid');
    expect(payload.order.discount_codes).toBeUndefined();
    expect(lineItems[0].taxable).toBe(false);
    expect(lineItems[0].tax_lines).toEqual([]);
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'payment_type', value: 'prepayment_300' },
      { name: 'Payment', value: 'Накладений платіж' },
      { name: 'Payment tag', value: 'prepayment_300_unpaid' },
      { name: 'payment_tag', value: 'prepayment_300_unpaid' },
      { name: 'Cash on delivery', value: 'true' },
      { name: 'Partial payment value - Monobank', value: '300 UAH' },
    ]));
  });

  test('full payment order created after Monobank success is paid immediately', () => {
    const payload = buildPaidShopifyOrderPayload(basePayload, 1200, 'invoice-paid-1');

    expect(payload.order.financial_status).toBe('paid');
    expect(payload.order.tags).toBe('full_payment_paid');
    expect(String(payload.order.note)).toBe('');
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'payment_type', value: 'full_payment' },
      { name: 'payment_status', value: 'paid' },
      { name: 'Сума', value: '1200' },
      { name: 'Сплата', value: '1200' },
      { name: 'Paid amount', value: '1200' },
      { name: 'Payment', value: 'Повна оплата' },
      { name: 'Payment tag', value: 'full_payment_paid' },
      { name: 'payment_tag', value: 'full_payment_paid' },
      { name: 'Cash on delivery', value: 'false' },
      { name: 'monobank_invoice_id', value: 'invoice-paid-1' },
    ]));
  });

  test('prepayment order created after Monobank success is partially paid with Checkly fields', () => {
    const prepaymentPayload = { ...basePayload, payment_type: 'prepayment' as const, cart_total: 1200 };
    const payload = buildPaidShopifyOrderPayload(prepaymentPayload, 300, 'invoice-paid-300');

    expect(payload.order.financial_status).toBe('partially_paid');
    expect(payload.order.tags).toBe('prepayment_300_paid');
    expect(String(payload.order.note)).toBe('');
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'payment_type', value: 'prepayment_300' },
      { name: 'payment_status', value: 'partially_paid' },
      { name: 'Сума', value: '1200' },
      { name: 'Сплата', value: '300' },
      { name: 'Paid amount', value: '300' },
      { name: 'Payment', value: 'Накладений платіж' },
      { name: 'Payment tag', value: 'prepayment_300_paid' },
      { name: 'payment_tag', value: 'prepayment_300_paid' },
      { name: 'Cash on delivery', value: 'true' },
      { name: 'Partial payment value - Monobank', value: '300 UAH' },
      { name: 'monobank_invoice_id', value: 'invoice-paid-300' },
    ]));
  });

  test('international order created after payment keeps delivery details in Comment attribute', () => {
    const internationalPayload: CheckoutPayload = {
      ...basePayload,
      payment_type: 'full',
      amount: 2200,
      cart_total: 2200,
      shipping_type: 'international',
      shipping: {
        type: 'international',
        country: 'Spain',
        country_code: 'ES',
        intl_city: 'Tarragona',
        address: 'Calle L. Van Beethoven',
        apartment: '7A',
        postcode: '43007',
      },
      comment: 'Добрий день, відправте Новою поштою',
    };
    const payload = buildPaidShopifyOrderPayload(internationalPayload, 2200, 'invoice-intl-1');
    const commentAttribute = (payload.order.note_attributes as Array<{ name?: string; value?: string }>)
      .find((attribute) => attribute.name === 'Comment');

    expect(payload.order.financial_status).toBe('paid');
    expect(commentAttribute?.value).toContain('Добрий день, відправте Новою поштою');
    expect(commentAttribute?.value).toBe('Добрий день, відправте Новою поштою');
  });

  test('prepayment after payment marks Shopify as partially paid and stores paid amount', () => {
    const update = buildOrderUpdateAfterPayment(123, 300, 'invoice-1', 'prepayment', [
      { name: 'payment_type', value: 'prepayment_300' },
      { name: 'shipping_type', value: 'ukraine' },
      { name: 'Сума', value: '1200' },
      { name: 'Сплата', value: '0' },
    ], 'manual, not_paid_300, prepayment_300_unpaid');
    expect(update.financial_status).toBe('partially_paid');
    expect(update.tags).toBe('manual, prepayment_300_paid');
    expect(String(update.note)).toBe('');
    expect(update.discount_codes).toBeUndefined();
    expect(update.note_attributes).toEqual([
      { name: 'payment_type', value: 'prepayment_300' },
      { name: 'shipping_type', value: 'ukraine' },
      { name: 'Сума', value: '1200' },
      { name: 'Сплата', value: '300' },
      { name: 'payment_status', value: 'partially_paid' },
      { name: 'payment_tag', value: 'prepayment_300_paid' },
      { name: 'Payment tag', value: 'prepayment_300_paid' },
      { name: 'Payment status tag', value: 'prepayment_300_paid' },
      { name: 'Payment', value: 'Передплата Monobank' },
      { name: 'Paid amount', value: '300' },
      { name: 'monobank_paid_amount', value: '300' },
      { name: 'monobank_invoice_id', value: 'invoice-1' },
    ]);
  });

  test('full payment after payment sets paid status and no prepayment tag', () => {
    const update = buildOrderUpdateAfterPayment(123, 1200, 'invoice-1', 'full', [
      { name: 'payment_type', value: 'full_payment' },
      { name: 'shipping_type', value: 'ukraine' },
    ], 'manual, full_payment_unpaid', [
      'Передзвоніть клієнту',
      '',
      'CRM оплата:',
      'Payment: Повна оплата',
      'Сума: 1200',
      'Сплата: 0',
      'Статус оплати: unpaid',
      'Тег оплати: full_payment_unpaid',
    ].join('\n'));
    expect(update.financial_status).toBe('paid');
    expect(update.tags).toBe('manual, full_payment_paid');
    expect(String(update.note)).toContain('Передзвоніть клієнту');
    expect(String(update.note)).not.toContain('CRM оплата:');
    expect(String(update.note)).not.toContain('Сплата: 0');
    expect(update.note_attributes).toEqual([
      { name: 'payment_type', value: 'full_payment' },
      { name: 'shipping_type', value: 'ukraine' },
      { name: 'payment_status', value: 'paid' },
      { name: 'payment_tag', value: 'full_payment_paid' },
      { name: 'Payment tag', value: 'full_payment_paid' },
      { name: 'Payment status tag', value: 'full_payment_paid' },
      { name: 'Payment', value: 'Повна оплата' },
      { name: 'Сплата', value: '1200' },
      { name: 'Paid amount', value: '1200' },
      { name: 'monobank_paid_amount', value: '1200' },
      { name: 'monobank_invoice_id', value: 'invoice-1' },
      { name: 'Сума', value: '1200' },
    ]);
  });

  test('installments order is marked separately and becomes paid after approval', () => {
    const payload = buildShopifyOrderPayload({ ...basePayload, payment_type: 'installments' }, 1200);
    expect(payload.order.financial_status).toBe('pending');
    expect(payload.order.tags).toBe('monobank_parts_unpaid');
    expect(payload.order.note_attributes).toEqual(expect.arrayContaining([
      { name: 'payment_type', value: 'monobank_parts' },
      { name: 'shipping_type', value: 'ukraine' },
      { name: 'Payment', value: 'Покупка частинами Monobank' },
      { name: 'Cash on delivery', value: 'false' },
    ]));

    const update = buildOrderUpdateAfterPayment(123, 1200, 'parts-order-1', 'installments', [
      { name: 'payment_type', value: 'monobank_parts' },
      { name: 'shipping_type', value: 'ukraine' },
    ]);
    expect(update.financial_status).toBe('paid');
    expect(update.tags).toBe('monobank_parts_paid');
    expect(update.note_attributes).toEqual([
      { name: 'payment_type', value: 'monobank_parts' },
      { name: 'shipping_type', value: 'ukraine' },
      { name: 'payment_status', value: 'paid' },
      { name: 'payment_tag', value: 'monobank_parts_paid' },
      { name: 'Payment tag', value: 'monobank_parts_paid' },
      { name: 'Payment status tag', value: 'monobank_parts_paid' },
      { name: 'Payment', value: 'Покупка частинами Monobank' },
      { name: 'Сплата', value: '1200' },
      { name: 'Paid amount', value: '1200' },
      { name: 'monobank_paid_amount', value: '1200' },
      { name: 'monobank_invoice_id', value: 'parts-order-1' },
      { name: 'Сума', value: '1200' },
    ]);
  });

  test('Nova Poshta branch maps city and branch separately', () => {
    const address = buildShippingAddress(basePayload);
    expect(address.city).toBe('Київ');
    expect(address.address1).toBe('Відділення: Відділення №12');
    expect(address.address2).toBe('Відділення');
  });

  test('Nova Poshta shipping price is paid on delivery and not added to the order total', () => {
    const novaPoshtaPayload: CheckoutPayload = {
      ...basePayload,
      payment_type: 'no_prepayment',
      amount: 0,
      shipping: {
        ...basePayload.shipping,
        shipping_price: 80,
      },
    };
    const payload = buildShopifyOrderPayload(novaPoshtaPayload, getPaymentAmount(novaPoshtaPayload));

    expect(getShippingPrice(novaPoshtaPayload)).toBe(0);
    expect(payload.order.shipping_lines).toBeUndefined();
    expect(payload.order.note_attributes).not.toEqual(expect.arrayContaining([
      { name: 'delivery_price', value: '80' },
    ]));
  });

  test('Nova Poshta address delivery maps street/house separately from apartment', () => {
    const address = buildShippingAddress({
      ...basePayload,
      shipping: {
        type: 'ukraine',
        delivery_method: 'address',
        city: 'Львів',
        street: 'Шевченка',
        house: '10',
        apartment: '5',
      },
    });
    expect(address.city).toBe('Львів');
    expect(address.address1).toBe('Шевченка, 10');
    expect(address.address2).toBe('5');
  });
});
