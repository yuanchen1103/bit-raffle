const AWS = require("aws-sdk")
const docClient = new AWS.DynamoDB.DocumentClient()

const get = (table, key, projectionExp) => {
  const params = {
    TableName: table,
    Key: key
  }

  if (projectionExp) {
    params.ProjectionExpression = projectionExp
  }

  return docClient.get(params).promise().then(data => {
    return Promise.resolve(data.Item || {})
  })
}

const query = (table, index, condObj, projectionExp, limit = null) => {
  const params = {
    TableName: table
  }

  if (index) {
    params.IndexName = index
  }

  if (condObj && Object.keys(condObj).length > 0) {
    params.KeyConditionExpression = Object.keys(condObj).map(key => `#${key} = :${key}`).join(' and ')
    params.ExpressionAttributeNames = {}
    params.ExpressionAttributeValues = {}
    Object.keys(condObj).forEach(key => {
      params.ExpressionAttributeNames[`#${key}`] = key
    })
    Object.keys(condObj).forEach(key => {
      params.ExpressionAttributeValues[`:${key}`] = condObj[key]
    })
  }

  if (projectionExp) {
    params.ProjectionExpression = projectionExp
  }

  if (limit && typeof limit === 'number') {
    params.Limit = limit
  }

  return docClient.query(params).promise().then(data => {
    if (data && data.Items) {
      return Promise.resolve(data.Items)
    }
    return Promise.resolve([])
  })
}

const put = (table, obj) => {
  const params = {
    TableName: table,
    Item: obj
  }

  return docClient.put(params).promise().then(data => {
    return Promise.resolve(data.Item || {})
  }).catch(err => {
    console.error(err)
    return Promise.reject(err)
  })
}

const update = (table, key, updateObj) => {
  const params = {
    TableName: table,
    Key: key,
    ReturnValues: 'UPDATED_NEW'
  }

  params.UpdateExpression = 'set ' + Object.keys(updateObj).map(key => `#${key} = :${key}`).join(', ')
  params.ExpressionAttributeNames = {}
  params.ExpressionAttributeValues = {}
  Object.keys(updateObj).forEach(key => {
    params.ExpressionAttributeNames[`#${key}`] = key
  })
  Object.keys(updateObj).forEach(key => {
    params.ExpressionAttributeValues[`:${key}`] = updateObj[key]
  })

  return docClient.update(params).promise().then(data => {
    return Promise.resolve(data.Item || {})
  })
}

module.exports = {
  get,
  query,
  put,
  update
}
