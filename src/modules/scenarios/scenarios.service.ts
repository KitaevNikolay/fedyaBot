import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ScenariosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.scenario.findMany();
  }

  async findById(id: string) {
    return this.prisma.scenario.findUnique({ where: { id } });
  }

  async findByCode(code: string) {
    return this.prisma.scenario.findUnique({ where: { code } });
  }
}
