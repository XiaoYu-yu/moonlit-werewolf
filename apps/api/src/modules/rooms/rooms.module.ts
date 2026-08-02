import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiTurnQueueService } from './ai-turn-queue.service.js';
import { RoomRuntimeService } from './room-runtime.service.js';
import { RoomsController } from './rooms.controller.js';
import { RoomsGateway } from './rooms.gateway.js';
import { RoomsService } from './rooms.service.js';

@Module({
  imports: [AdminModule],
  controllers: [RoomsController],
  providers: [AiTurnQueueService, RoomsService, RoomRuntimeService, RoomsGateway],
  exports: [RoomsService],
})
export class RoomsModule {}
