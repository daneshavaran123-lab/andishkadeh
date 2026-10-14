import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Serializable transactions with retry on write conflicts (P2034). */
  async serializable<T>(fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e) {
        if (attempt < retries && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') continue;
        throw e;
      }
    }
  }
}
