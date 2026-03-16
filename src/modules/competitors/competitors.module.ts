import { Module } from '@nestjs/common';
import { CompetitorsService } from './competitors.service';

@Module({
  providers: [CompetitorsService],
  exports: [CompetitorsService],
})
export class CompetitorsModule {}
