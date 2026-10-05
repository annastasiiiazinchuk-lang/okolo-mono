import { describe, expect, test } from 'bun:test';
import { validateCheckoutRequiredFields } from '../../lib/routes/orders';
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
  },
  utm: {},
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
});
