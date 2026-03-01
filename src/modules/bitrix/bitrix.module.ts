import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BitrixService } from './bitrix.service';

@Module({
  imports: [HttpModule],
  providers: [BitrixService],
  exports: [BitrixService],
})
export class BitrixModule {}
