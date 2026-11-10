import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/**
 * Events, feed and stories — the core content engine.
 * Owner: Bayo (tech lead).
 */
@Module({
  imports: [IdentityModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
