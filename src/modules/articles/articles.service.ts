import { Injectable } from '@nestjs/common';
import { ArticleAdditionType, TechnicalArticleAdditionState } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CompetitorsService } from '../competitors/competitors.service';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly competitorsService: CompetitorsService,
  ) {}

  async create(userId: string, title: string) {
    return this.prisma.article.create({
      data: {
        userId,
        title,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.article.findUnique({
      where: { id },
      include: {
        additions: {
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        },
        versions: {
          orderBy: { iteration: 'desc' },
          take: 1,
        },
      },
    });
  }

  async addAddition(
    articleId: string,
    type: ArticleAdditionType,
    content: string,
  ) {
    // Если добавляется основной текст статьи, проверяем на конкурентов
    if (type === ArticleAdditionType.ARTICLE) {
      await this.updateArticleCompetitors(articleId, content);
    }

    return this.prisma.articleAddition.upsert({
      where: {
        articleId_type: {
          articleId,
          type,
        },
      },
      create: {
        articleId,
        type,
        content,
      },
      update: {
        content,
      },
    });
  }

  async updateAddition(
    articleId: string,
    type: ArticleAdditionType,
    content: string,
  ) {
    // Если обновляется основной текст статьи, проверяем на конкурентов
    if (type === ArticleAdditionType.ARTICLE) {
      await this.updateArticleCompetitors(articleId, content);
    }

    return this.prisma.articleAddition.upsert({
      where: {
        articleId_type: {
          articleId,
          type,
        },
      },
      create: {
        articleId,
        type,
        content,
      },
      update: {
        content,
      },
    });
  }

  async createVersion(
    articleId: string,
    content: string,
    rewriteType?: string | null,
  ) {
    // При создании новой версии (рерайт) тоже проверяем на конкурентов
    await this.updateArticleCompetitors(articleId, content);

    const count = await this.prisma.articleVersion.count({
      where: { articleId },
    });

    return this.prisma.articleVersion.create({
      data: {
        articleId,
        content,
        iteration: count + 1,
        rewriteType: rewriteType ?? 'none',
      },
    });
  }

  private async updateArticleCompetitors(articleId: string, content: string) {
    const found = this.competitorsService.findCompetitors(content);
    const competitorsString = found.join(', ');

    // Сохраняем результат проверки в TechnicalArticleAddition
    await this.prisma.technicalArticleAddition.upsert({
      where: {
        id: `competitors_check_${articleId}`, // Генерируем фиксированный ID для апсерта
      },
      create: {
        id: `competitors_check_${articleId}`,
        articleId,
        state: TechnicalArticleAdditionState.FINISHED,
        technicalInfo: competitorsString,
      },
      update: {
        technicalInfo: competitorsString,
        updatedAt: new Date(),
      },
    });
  }

  async getCompetitors(articleId: string): Promise<string[]> {
    const check = await this.prisma.technicalArticleAddition.findUnique({
      where: { id: `competitors_check_${articleId}` },
    });

    if (!check || !check.technicalInfo) return [];
    return check.technicalInfo.split(', ').filter(s => s.length > 0);
  }

  async updateVersion(id: string, content: string) {
    return this.prisma.articleVersion.update({
      where: { id },
      data: { content },
    });
  }

  async updateTitle(id: string, title: string) {
    return this.prisma.article.update({
      where: { id },
      data: { title },
    });
  }
}
