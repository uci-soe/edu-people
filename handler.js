'use strict';

const { ApolloServer, gql } = require('apollo-server-lambda');
const GraphQLJSON           = require('graphql-type-json');
const model                 = require('./lib/model');

const db = model('edu-people', {});

/*
  # Questions to answer
  - what can this person do in this (a specific) website?
  - who can access this website?
  - what websites can this person access?
  - who can access what sites?
 */

/**
 * Description of a user
 *
 * @typedef {Object} Person
 * @property {String} ucinetid
 * @property {String} [email] defaults to {ucinetid}@uci.edu
 * @property {String} firstName
 * @property {String} [middleName]
 * @property {String} lastName
 * @property {String} [photo]
 * @property {Permission} [service]
 * @property {Object<Permission>} [services] Object containing permissions, where the service name is the key for the permissions
 */
/**
 * Description of permissions of a user in a service
 *
 * @typedef {Object} Permission
 * @property {String} service
 * @property {Array<String>} roles
 * @property {Object} settings
 */

// Construct a schema, using GraphQL schema language
const typeDefs = gql`
  scalar JSON

  type Query {
    """
    UCINetID to find the person and service to search for.
    """
    person(ucinetid: String!): Person

    """
    All people with service provided will be returned.
    Optionally, 'all' (insensitive) may be provided to get all people, nomatter the services
    """
    people(service: String!): [Person]!
  }
  type Mutation {
    setPerson(input: PersonInput): Person
    setPermission(ucinetid: String!, permission: PermissionInput!): Person
    removePermission(ucinetid: String!, service: String!): Person
  }

  type Person {
    ucinetid: String!
    email: String!
    firstName: String!
    middleName: String
    lastName: String!
#    preferedName: String!
    photo: String
    "Only available if providing a service on request"
    service(service: String!): Permission
    "all services. best for audit only purposes"
    services: [Permission]!
  }
  type Permission {
    "service name"
    service: String!
    "list of roles user provides"
    roles: [String]!
    "settings the service sets for user. format unknown"
    settings: JSON!
  }

  input PersonInput {
    ucinetid: String!
    email: String
    firstName: String
    middleName: String
    lastName: String
    photo: String
  }
  input PermissionInput {
    "service name"
    service: String!
    "list of roles user provides"
    roles: [String]
    "settings the service sets for user. format unknown"
    settings: JSON
  }

`;

// Provide resolver functions for your schema fields
const resolvers = {
  Query:  {
    person: (_, { ucinetid }) => db.findPerson(ucinetid),
    people: (_, { service }) => db.scanPeople(service),
  },
  Mutation: {
    // setPerson(input: PersonInput): Person
    setPerson: (_, {input: person}) => db.upsertPerson(person),
    // setPermission(ucinetid: String!, permission: PermissionCreateInput!): Person
    setPermission: (_, {ucinetid, permission}) => db.setPermission(ucinetid, permission),
    // removePermission(ucinetid: String!, service: String!): Person
    removePermission: (_, {ucinetid, service}) => db.removePermission(ucinetid, service),
  },
  JSON:   GraphQLJSON,
  Person: {
    email:    ({ ucinetid, email }) => email || `${ucinetid}@uci.edu`,
    service:  ({ _services }, { service }) => {
      if (!service || /^all$/i.test(service) || !_services[service]) {
        return;
      }

      return { ..._services[service], service };
    },
    services: ({ _services }) => {
      return Object.getOwnPropertyNames(_services || {})
        .map(key => ({ ..._services[key], service: key }))
        ;
    }
  }
};

const server = new ApolloServer({ typeDefs, resolvers });

module.exports.graphql = server.createHandler({
  cors: {
    origin: '*',
    credentials: true,
  },
});
