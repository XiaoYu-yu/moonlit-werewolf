import { Module } from '@nestjs/common';
import { RoomsModule } from '../rooms/rooms.module.js';
import { AudioController } from './audio.controller.js';
import { AudioService } from './audio.service.js';
import { PlayerSessionGuard } from './player-session.guard.js';

@Module({
  imports: [RoomsModule],
  controllers: [AudioController],
  providers: [AudioService, PlayerSessionGuard],
})
export class AudioModule {}
