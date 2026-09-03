import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BitrixService } from './bitrix.service';

const BITRIX_HTTP_TIMEOUT_MS = 30_000;

@Module({
  imports: [HttpModule.register({ timeout: BITRIX_HTTP_TIMEOUT_MS })],
  providers: [BitrixService],
  exports: [BitrixService],
})
export class BitrixModule {}
