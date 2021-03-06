'use strict'

const { EventEmitter } = require('events')
const Promise = require('bluebird')
const request = require('request')
const R = require('ramda')

const RateLimiter = require('./rateLimiter')

const MAX_RETRIES = 5
const TIME_WAIT_RIOT_API_MS = 100

class RetryLimitError extends Error {
  constructor (msg) {
    super(`${msg}\nMax retries hit while trying to request data`)
  }
}
class BadRequestError extends Error {}
class UnauthorizedError extends Error {}
class RequestError extends Error {}
class APIUnavailableError extends RequestError {
  constructor () {
    super('Riot API is currently unavailable')
  }
}
class RateLimitError extends RequestError {
  constructor (time) {
    super('Rate Limit Hit. Slow your Roll')
    this.waitTime = time
  }
}
class UserLimitError extends RateLimitError {}
class ServiceLimitError extends RateLimitError {}
class UnknownLimitError extends RateLimitError {}
// class NotFoundError extends RequestError {}

class RequestWorker extends EventEmitter {
  constructor ({
    region: optsRegion = 'na',
    rateLimits: optsRateLimit = [
      { interval: 10, limit: 10 },
      { interval: 600, limit: 500 }]
  }) {
    super()

    this._limiter = new RateLimiter(optsRateLimit)
    this._workQueue = []
    this._working = false
    this._region = optsRegion
    this._stats = {
      errors: 0,
      apiErrors: 0,
      rateErrors: 0,
      workerErrors: 0,
      requestErrors: 0,
      highWaterMark: 0
    }
  }

  getStats () {
    return R.clone(this._stats)
  }

  makeRequest (url) {
    return new Promise((resolve, reject) => {
      var req = {
        retries: 0,
        resolve: resolve,
        reject: reject,
        url: url
      }
      this._workQueue.push(req)
      this._startWorkThread()
    })
  }

  destroy () {
    this.emit('destroyed', this._region)
    this.removeAllListeners()
  }

  _onError (err) {
    this._stats.errors++
    this.emit('error', err, this._region)
  }

  _startWorkThread () {
    if (this._working) {
      return
    }

    this._working = true
    return setImmediate(() => this._workThread())
  }

  _workThread () {
    if (this._workQueue.length <= 0) {
      this._working = false
      return
    }

    this._stats.highWaterMark = R.max(this._workQueue.length, this._stats.highWaterMark)

    if (this._stats.higWaterMark >= 40) {
      this.emit('highRequests', this._region, this._stats.highWaterMark)
      console.log(`[Ashe] Holy Crap! Over 40 items queued in the '${this._region}' worker`)
    }

    return this._limiter.wait()
    .then(() => this._workQueue.shift())
    .then(req => this._doWork(req).then(req.resolve, req.reject))
    .catch(err => {
      this._stats.workerErrors++
      this._onError(err)
      console.error(`[Ashe] Error in '${this._region}' work thread\n${err.message}`)
    })
    .then(() => setImmediate(() => this._workThread()))
  }

  _doWork (req) {
    var p = this._doRequest(req.url)
    if (++req.retries > MAX_RETRIES) {
      p.catch(RequestError, err => Promise.reject(new RetryLimitError(err.message)))
    }
    return p.catch(UserLimitError, ServiceLimitError, err => {
      this._stats.rateErrors++
      this.emit('rateLimit', this._region)

      return Promise.delay(err.watTime * 1000)
      .then(() => this._doWork(req))
    })
    .catch(UnknownLimitError, () => {
      this._stats.rateErrors++
      this.emit('rateLmit', this._region)

      return Promise.delay(1000)
      .then(() => this._doWork(req))
    })
    .catch(APIUnavailableError, () => {
      this._stats.apiErrors++

      return Promise.delay(TIME_WAIT_RIOT_API_MS)
      .then(() => this._doWork(req))
    })
    // .catch(NotFoundError, () => null)
  }

  _doRequest (url) {
    return new Promise((resolve, reject) => {
      request({ uri: url, gzip: true }, (err, res, body) => {
        if (err) {
          this._stats.requestErrors++
          return reject(err)
        }

        switch (res.statusCode) {
          case 400:
            return reject(new BadRequestError(body))

          case 401:
          case 403:
            return reject(new UnauthorizedError())

          case 404:
            return resolve(null)
            // return reject(new NotFoundError())

          case 415:
            return resolve(null)

          case 429:
            var {
              'retry-after': retryTime,
              'x-rate-limit-type': limitType
            } = res.headers

            if (retryTime && limitType) {
              if (limitType === 'user') {
                return reject(new UserLimitError(retryTime))
              } else if (limitType === 'service') {
                return reject(new ServiceLimitError(retryTime))
              }
            }
            return reject(new UnknownLimitError(retryTime))

          case 500:
          case 503:
            return reject(new APIUnavailableError())

          default:
            return resolve(body)
        }
      })
    })
  }
}

module.exports = {
  RequestWorker,
  RetryLimitError,
  BadRequestError,
  UnauthorizedError
}
