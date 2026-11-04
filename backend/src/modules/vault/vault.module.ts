import { Module } from '@nestjs/common';
import { DmpService } from './dmp.service';
import { GrantService } from './grant.service';
import { VaultController } from './vault.controller';
import { GrantSweeper } from './grant-sweeper.job';

@Module({
  controllers: [VaultController],
  providers: [DmpService, GrantService, GrantSweeper],
  exports: [DmpService, GrantService],
})
export class VaultModule {}
