import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ScenariosService } from './scenarios.service';

@Module({
  imports: [DatabaseModule],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
