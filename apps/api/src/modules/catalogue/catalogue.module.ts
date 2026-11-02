import { Module } from '@nestjs/common';
import { CatalogueAdminController, CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

@Module({ controllers: [CatalogueController, CatalogueAdminController], providers: [CatalogueService], exports: [CatalogueService] })
export class CatalogueModule {}
