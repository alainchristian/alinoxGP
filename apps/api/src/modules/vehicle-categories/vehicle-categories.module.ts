import { Module } from '@nestjs/common';
import { VehicleCategoriesController } from './vehicle-categories.controller';
import { VehicleCategoriesService } from './vehicle-categories.service';

@Module({ controllers: [VehicleCategoriesController], providers: [VehicleCategoriesService] })
export class VehicleCategoriesModule {}
