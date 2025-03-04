import { SchemaManager } from '../store/SchemaManager';

SchemaManager.parseYAML(`
  User:
    idAttribute: id
    listings: [Listing]
    likes: [Like]
    photos: [Photo]
    nested: Nested
    friends: [User]
    profile: Profile
    posts: [Post]
    comments: [Comment]

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
  
  Website:
    idAttribute: id
    sitemaps: [Sitemap]
    vendors: [Vendor]
    products: [Product]

  Vendor:
    idAttribute: name
    website: Website
    products: [Product]
    collections: [Collection]
  
  Collection:
    idAttribute: id
    products: [Product]

  Product:
    idAttribute: id
    vendor: Vendor
    website: Website

  Sitemap:
    idAttribute: id
    website: Website
    links: [Link]

  Link:
    idAttribute: id
    sitemap: Sitemap

  Browser:
    idAttribute: id

  Profile:
    idAttribute: id
    user: User

  Post:
    idAttribute: id
    author: User
    comments: [Comment]
  
  Comment:
    idAttribute: id
    post: Post
    author: User
`);

export const { schemas } = SchemaManager;
export const {
  User,
  Listing,
  Photo,
  Like,
  Website,
  Vendor,
  Collection,
  Product,
  Sitemap,
  Link,
  Browser,
  Profile,
  Post,
  Comment
} = schemas;
export default schemas;
