import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string) {
    return this.prisma.session.create({
      data: {
        userId,
      },
    });
  }

  async findActive(userId: string) {
    // В простейшем случае считаем последнюю созданную сессию активной
    // Или можно добавить логику проверки времени жизни
    return this.prisma.session.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        // Подгрузим связанные данные если нужно, пока оставим базово
      },
    });
  }

  async updateScenario(sessionId: string, scenarioId: string) {
    return this.prisma.session.update({
      where: { id: sessionId },
      data: { scenarioId },
    });
  }

  async updateArticle(sessionId: string, articleId: string) {
    return this.prisma.session.update({
      where: { id: sessionId },
      data: { articleId },
    });
  }

  async delete(id: string) {
    return this.prisma.session.delete({
      where: { id },
    });
  }
}
