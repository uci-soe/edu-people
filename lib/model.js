const AWS = require('aws-sdk');

AWS.config.update({
  region: 'us-west-2'
});

const getClient = (type, options) => {
  return type === 'dynamodb'
         ? new AWS.DynamoDB(options)
         : new AWS.DynamoDB.DocumentClient(options)
    ;
};

const defaultOptions = {};

module.exports = (table, options) => {
  options = { ...defaultOptions, ...options };

  return {
    findPerson,
    scanPeople,
    upsertPerson,
    createPerson,
    updatePerson,

    setPermission,
    removePermission,
  };

  /**
   * Find a person by UCINetID
   *
   * @param {String} ucinetid UCINetID of the person in question
   * @return {Promise<Person>}
   */
  function findPerson (ucinetid) {
    const params = {
      TableName: table,
      Key:       { ucinetid }
    };

    return new Promise((res, rej) => {
      getClient('document', options).get(params, function (err, data) {
        if (err) {
          rej(err);
        } else {
          res(data.Item);
        }
      });
    });
  }

  /**
   * Find all people of a service or all services
   *
   * @param {String} service name of service or string 'all' (insensitive) for all services
   * @param {Object} [paramOptions] additional searching options, see scan options: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
   * @return {Promise<Array<Person>>}
   */
  function scanPeople (service, paramOptions = {}) {
    let filter;
    if (/^all$/i.test(service)) {
      filter = {};
    } else {
      filter = {
        FilterExpression: 'attribute_exists(#services.#serviceName)',
        ExpressionAttributeNames:  {
          '#services': '_services',
          '#serviceName': service
        },

      }
    }

    const params = {
      TableName: table,
      ...filter,
      ...paramOptions
    };

    return new Promise((res, rej) => {
      let out         = [];
      const docClient = getClient('document', options);

      const onScan = (err, data) => {
        if (err) {
          rej(err);
        } else {
          out = out.concat(data.Items);

          // continue scanning if we have more movies, because
          // scan can retrieve a maximum of 1MB of data
          if (typeof data.LastEvaluatedKey != 'undefined') {
            params.ExclusiveStartKey = data.LastEvaluatedKey;
            // recurse to continue
            docClient.scan(params, onScan);
          } else {
            // done
            res(out);
          }
        }
      };

      // initiate call
      docClient.scan(params, onScan);

    });
  }

  /**
   * Add or update a person
   *
   * @param {Person} person
   * @return {Promise<Person>} the newly created/updated person
   */
  function upsertPerson (person) {

    return findPerson(person.ucinetid.toLowerCase())
      .then(foundPerson => {
        return foundPerson ? updatePerson(person) : createPerson(person);
      })
  }

  /**
   * Create a new person
   *
   * @param {Person} person Person to create
   * @return Promise<Person> Person after creation
   */
  function createPerson (person) {

    // intentionally ignoring service and services as they shouldn'y be updated here.
    const params = {
      TableName: table,
      Item:      {
        ucinetid:  person.ucinetid.toLowerCase(),
        firstName: person.firstName,
        lastName:  person.lastName,

        ...(person.firstName ? {} : {}),
        ...(person.middleName ? { middleName: person.middleName } : {}),
        ...(person.email ? { email: person.email } : {}),
        ...(person.photo ? { photo: person.photo } : {}),

        _services: {}
      }

    };

    return new Promise((res, rej) => {
      getClient('document', {}).put(params, function (err, data) {
        if (err) {
          rej(err);
        } else {
          res();
        }
      });
    })
      .then(() => findPerson(params.Item.ucinetid))
      ;
  }

  /**
   * Update a person's basic data.
   *
   * @param {Person} person attributes of a person to update to the database.
   * @return Promise<Person> person after update
   */
  function updatePerson (person) {

    let keys   = [];
    let values = {};
    Object.getOwnPropertyNames(person)
      .filter(key => !([ 'ucinetid', 'service', 'services', '_services' ].includes(key))) // don't update these fields
      .forEach(key => {
        keys.push(`${key} = :${key}`);
        values[`:${key}`] = person[key];
      });


    const params = {
      TableName:                 table,
      Key:                       {
        'ucinetid': person.ucinetid,
      },
      UpdateExpression:          `set ${keys.join(', ')}`,
      ExpressionAttributeValues: values,
      ReturnValues:              'ALL_NEW'
    };

    return new Promise((res, rej) => {
      getClient('document', options).update(params, function (err, data) {
        if (err) {
          rej(err);
        } else {
          res(data);
        }
      });
    })
      .then(() => findPerson(person.ucinetid))
  }

  /**
   * Set the permissions of a user in a service.
   *
   *
   * @param {String} ucinetid id of the person to alter
   * @param {Permission} permission new rules
   * @return Promise<Person> the person after alterations
   */
  function setPermission (ucinetid, permission) {

    ucinetid = ucinetid.toLowerCase();

    return findPerson(ucinetid)
      .then(foundPerson => {
        if (!foundPerson) {
          throw new Error(`There is no one with ucinetid ${ucinetid}`);
        }

        const params = {
          TableName:                 table,
          Key:                       {
            'ucinetid': ucinetid,
          },
          UpdateExpression:          `set #services.#serviceName = :permission`,
          ExpressionAttributeNames:  {
            '#services': '_services',
            '#serviceName': permission.service
          },
          ExpressionAttributeValues: {
            ':permission': permission
          },
          ReturnValues:              'ALL_NEW'
        };

        return new Promise((res, rej) => {
          getClient('document', options).update(params, function (err, data) {
            if (err) {
              rej(err);
            } else {
              res(data);
            }
          });
        })
          .then(data => findPerson(ucinetid))
          ;
      })


  }

  /**
   * Remove the permissions of a user in a service.
   *
   *
   * @param {String} ucinetid id of the person to alter
   * @param {String} service service to remove
   * @return Promise<Person> the person after alterations
   */
  function removePermission (ucinetid, service) {

    ucinetid = ucinetid.toLowerCase();

    return findPerson(ucinetid)
      .then(foundPerson => {
        if (!foundPerson) {
          throw new Error(`There is no one with ucinetid ${ucinetid}`);
        }

        const params = {
          TableName:                table,
          Key:                      {
            'ucinetid': ucinetid,
          },
          UpdateExpression:         `remove #services.#serviceName`,
          ExpressionAttributeNames:  {
            '#services': '_services',
            '#serviceName': service
          },
          ReturnValues:             'ALL_NEW'
        };

        return new Promise((res, rej) => {
          getClient('document', options).update(params, function (err, data) {
            if (err) {
              rej(err);
            } else {
              res(data);
            }
          });
        })
          .then(() => findPerson(ucinetid))
      })


  }

};
