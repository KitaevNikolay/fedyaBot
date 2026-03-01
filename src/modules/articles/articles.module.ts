import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ArticlesService } from './articles.service';

@Module({
  imports: [DatabaseModule],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
