import { Injectable } from '@nestjs/common';

export interface Order {
  id: string;
  userId: string;
  amount: number;
  status: string;
}

@Injectable()
export class OrderService {
  private readonly orders = new Map<string, Order>([
    ['123', { id: '123', userId: 'user-1', amount: 600, status: 'completed' }],
    ['456', { id: '456', userId: 'user-1', amount: 200, status: 'completed' }],
  ]);

  async findById(orderId: string, userId?: string): Promise<Order | null> {
    const order = this.orders.get(orderId) ?? null;
    if (!order) return null;
    if (userId && order.userId !== userId) {
      throw new Error(`Access denied for order ${orderId}`);
    }
    return order;
  }

  async refund(orderId: string, amount: number): Promise<{ refunded: boolean; amount: number }> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    order.status = 'refunded';
    return { refunded: true, amount };
  }
}
