import { Module } from '@nestjs/common';
import { CategoriesController, DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [DocumentsController, CategoriesController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
