import { Injectable } from '@nestjs/common';
import { ArticleAdditionType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { additions: true },
    });
  }

  async addAddition(
    articleId: string,
    type: ArticleAdditionType,
    content: string,
  ) {
    return this.prisma.articleAddition.create({
      data: {
        articleId,
        type,
        content,
      },
    });
  }

  async updateAddition(
    articleId: string,
    type: ArticleAdditionType,
    content: string,
  ) {
    const existing = await this.prisma.articleAddition.findFirst({
      where: { articleId, type },
    });

    if (existing) {
      return this.prisma.articleAddition.update({
        where: { id: existing.id },
        data: { content },
      });
    }

    return this.addAddition(articleId, type, content);
  }

  async createVersion(
    articleId: string,
    content: string,
    rewriteType?: string | null,
  ) {
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
}
