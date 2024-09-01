import { SchemaManager } from '../SchemaManager';

const schemaManager = SchemaManager.getInstance();

schemaManager.setSchemas({
  User: {
    idAttribute: 'id',
    listings: ['Listing']
  },
  Listing: {
    idAttribute: 'id',
    user: 'User'
  }
});

const schemas = schemaManager.getSchemas();
const { User, Listing } = schemas;
export { User, Listing };
export default schemas;
