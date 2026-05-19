import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  TechnicalArticleAddition,
  TechnicalArticleAdditionState,
} from '@prisma/client';

@Injectable()
export class TechnicalArticleAdditionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    articleId: string,
    state: TechnicalArticleAdditionState,
    technicalInfo?: string | null,
  ): Promise<TechnicalArticleAddition> {
    return this.prisma.technicalArticleAddition.create({
      data: {
        articleId,
        state,
        technicalInfo: technicalInfo ?? null,
      },
    });
  }

  async update(
    id: string,
    payload: Partial<{
      state: TechnicalArticleAdditionState;
      message: string | null;
      tries: number;
      technicalInfo: string | null;
    }>,
  ): Promise<TechnicalArticleAddition> {
    return this.prisma.technicalArticleAddition.update({
      where: { id },
      data: payload,
    });
  }

  async findLatestByArticleId(
    articleId: string,
  ): Promise<TechnicalArticleAddition | null> {
    return this.prisma.technicalArticleAddition.findFirst({
      where: { articleId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveByArticleId(
    articleId: string,
  ): Promise<TechnicalArticleAddition | null> {
    return this.prisma.technicalArticleAddition.findFirst({
      where: {
        articleId,
        state: {
          in: [
            TechnicalArticleAdditionState.NEW,
            TechnicalArticleAdditionState.RUNNING,
            TechnicalArticleAdditionState.PENDING,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActive(): Promise<TechnicalArticleAddition[]> {
    return this.prisma.technicalArticleAddition.findMany({
      where: {
        state: {
          in: [
            TechnicalArticleAdditionState.NEW,
            TechnicalArticleAdditionState.RUNNING,
            TechnicalArticleAdditionState.PENDING,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
