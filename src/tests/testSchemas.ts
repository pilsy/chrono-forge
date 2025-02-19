import { SchemaManager } from '../store/SchemaManager';

SchemaManager.parseYAML(`
  User:
    idAttribute: id
    listings: [Listing]
    likes: [Like]
    photos: [Photo]
    nested: Nested
  
  Listing:
    idAttribute: id
    user: User
    photos: [Photo]
  
  Photo:
    idAttribute: id
    likes: [Like]
    listing: Listing
  
  Like:
    idAttribute: id
    photo: Photo
    user: User
  
  Nested:
    idAttribute: id
    user: User
`);

const { schemas } = SchemaManager;
export const { User, Listing, Photo, Like } = schemas;
export default schemas;
