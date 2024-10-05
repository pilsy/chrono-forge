import { SchemaManager } from '../store/SchemaManager';

const schemaManager = SchemaManager.getInstance();

schemaManager.setSchemas({
  User: {
    idAttribute: 'id',
    listings: ['Listing'],
    likes: ['Like'],
    photos: ['Photo']
  },
  Listing: {
    idAttribute: 'id',
    user: 'User',
    photos: ['Photo']
  },
  Photo: {
    idAttribute: 'id',
    likes: ['Like'],
    listing: 'Listing'
    // user: 'User'
  },
  Like: {
    idAttribute: 'id',
    photo: 'Photo',
    user: 'User'
  }
});

const schemas = schemaManager.getSchemas();
const { User, Listing, Photo, Like } = schemas;
export { User, Listing, Photo, Like };
export default schemas;
