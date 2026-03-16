import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ArticlesService } from './articles.service';
import { CompetitorsModule } from '../competitors/competitors.module';

@Module({
  imports: [DatabaseModule, CompetitorsModule],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
