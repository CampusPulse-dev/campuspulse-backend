import { Module } from '@nestjs/common';
import { KeyValueStore, RedisKeyValueStore } from '../../common/kv/key-value-store';
import { StorageModule } from '../../common/storage/storage.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentVerificationController } from './student-verification.controller';
import { StudentVerificationService } from './student-verification.service';

/**
 * Student verification submission (email OTP + private ID upload).
 * Lives outside IdentityModule because it needs NotificationsModule, which
 * itself imports IdentityModule for the auth guards.
 */
@Module({
  imports: [IdentityModule, NotificationsModule, StorageModule],
  controllers: [StudentVerificationController],
  providers: [StudentVerificationService, { provide: KeyValueStore, useClass: RedisKeyValueStore }],
  exports: [KeyValueStore],
})
export class VerificationModule {}
