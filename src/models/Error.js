import  Resource from './Resource'

class Error extends Resource {
  constructor(...args) {
    super(...args)
    this.type = 'error'
  }
  toString() {
    return JSON.stringify(this)
  }
}

export default Error
