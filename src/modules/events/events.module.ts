import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { IdentityModule } from '../identity/identity.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { MediaController } from './media.controller';
import { SearchController } from './search.controller';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { ManagementController } from './management.controller';
import { ManagementService } from './management.service';

/**
 * Events, feed, search, media uploads, and 24-hour stories — the core content engine.
 * Owner: Bayo (tech lead).
 */
@Module({
  imports: [IdentityModule, StorageModule],
  controllers: [
    EventsController,
    StoriesController,
    MediaController,
    SearchController,
    ManagementController,
  ],
  providers: [EventsService, StoriesService, ManagementService],
  exports: [EventsService, StoriesService],
})
export class EventsModule {}
