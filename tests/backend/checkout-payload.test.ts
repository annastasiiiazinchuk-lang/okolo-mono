import { describe, expect, test } from 'bun:test';
import { checkoutPayloadSchema } from '../../lib/types/checkout';

const basePayload = {
  payment_type: 'full',
  amount: 1200,
  cart_total: 1200,
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
    warehouse: 'Відділення №12',
  },
  goods: [
    {
      variant_id: 111,
      name: 'Сукня',
      price: 1200,
      quantity: 1,
    },
  ],
};

describe('checkout payload validation', () => {
  test('accepts optional customer email', () => {
    const emptyEmail = checkoutPayloadSchema.parse({
      ...basePayload,
      customer: {
        first_name: 'Анастасія',
        last_name: 'Зінчук',
        phone: '+380682345729',
        email: '',
      },
    });

    const missingEmail = checkoutPayloadSchema.parse({
      ...basePayload,
      customer: {
        first_name: 'Анастасія',
        last_name: 'Зінчук',
        phone: '+380682345729',
      },
    });

    expect(emptyEmail.customer.email).toBe('');
    expect(missingEmail.customer.email).toBe('');
  });

  test('rejects invalid customer email', () => {
    expect(checkoutPayloadSchema.safeParse({
      ...basePayload,
      customer: {
        ...basePayload.customer,
        email: 'instagram only',
      },
    }).success).toBe(false);
  });

  test('accepts valid customer email', () => {
    const parsed = checkoutPayloadSchema.parse({
      ...basePayload,
      customer: {
        ...basePayload.customer,
        email: '  test@example.com  ',
      },
    });

    expect(parsed.customer.email).toBe('test@example.com');
  });

  test('accepts no-prepayment checkout type', () => {
    const parsed = checkoutPayloadSchema.parse({
      ...basePayload,
      payment_type: 'no_prepayment',
      amount: 0,
    });

    expect(parsed.payment_type).toBe('no_prepayment');
    expect(parsed.amount).toBe(0);
  });
});
