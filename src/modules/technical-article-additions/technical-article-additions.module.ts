import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { TechnicalArticleAdditionsService } from './technical-article-additions.service';

@Module({
  imports: [DatabaseModule],
  providers: [TechnicalArticleAdditionsService],
  exports: [TechnicalArticleAdditionsService],
})
export class TechnicalArticleAdditionsModule {}
