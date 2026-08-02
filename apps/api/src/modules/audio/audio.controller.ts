import {
  Controller,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ABSOLUTE_TRANSCRIPTION_UPLOAD_BYTES } from './audio-validation.js';
import { AudioService } from './audio.service.js';
import { PlayerSessionGuard } from './player-session.guard.js';

@Controller('audio')
export class AudioController {
  constructor(private readonly audio: AudioService) {}

  @Post('transcriptions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(PlayerSessionGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ABSOLUTE_TRANSCRIPTION_UPLOAD_BYTES, files: 1 },
    }),
  )
  transcribe(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: ABSOLUTE_TRANSCRIPTION_UPLOAD_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    return this.audio.transcribe(file);
  }
}
