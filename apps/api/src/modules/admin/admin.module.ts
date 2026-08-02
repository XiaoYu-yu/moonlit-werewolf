import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import {
  PROVIDER_CONFIG_REPOSITORY,
  createProviderConfigRepositoryForEnvironment,
} from './provider-config.repository.js';
import {
  ProviderSecretCipher,
  createProviderSecretCipherFromEnv,
} from './provider-secret-cipher.js';

@Module({
  controllers: [AdminController],
  providers: [
    {
      provide: ProviderSecretCipher,
      useFactory: createProviderSecretCipherFromEnv,
    },
    {
      provide: PROVIDER_CONFIG_REPOSITORY,
      useFactory: createProviderConfigRepositoryForEnvironment,
    },
    AdminService,
    AdminGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}
