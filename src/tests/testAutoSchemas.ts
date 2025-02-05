import { SchemaManager } from '../store/SchemaManager';
import { AutoSchema } from '../decorators/AutoSchema';

@AutoSchema()
export class UserSchema {
  id!: string;
  listings!: ListingSchema[];
  likes!: LikeSchema[];
  photos!: PhotoSchema[];
  nested!: NestedSchema;
}

@AutoSchema()
export class ListingSchema {
  id!: string;
  user!: UserSchema;
  photos!: PhotoSchema[];
}

@AutoSchema()
export class PhotoSchema {
  id!: string;
  likes!: LikeSchema[];
  listing!: ListingSchema;
}

@AutoSchema()
export class LikeSchema {
  id!: string;
  photo!: PhotoSchema;
  user!: UserSchema;
}

@AutoSchema()
export class NestedSchema {
  id!: string;
  user!: UserSchema;
}

const schemas = SchemaManager.getInstance().getSchemas();
export const { User, Listing, Photo, Like } = schemas;
export default schemas;
