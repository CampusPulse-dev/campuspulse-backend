import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { IdentityModule } from '../identity/identity.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { MediaController } from './media.controller';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

/**
 * Events, feed, media uploads, and 24-hour stories — the core content engine.
 * Owner: Bayo (tech lead).
 */
@Module({
  imports: [IdentityModule, StorageModule],
  controllers: [EventsController, StoriesController, MediaController],
  providers: [EventsService, StoriesService],
  exports: [EventsService, StoriesService],
})
export class EventsModule {}
