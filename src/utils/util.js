
export function get () {
  let keys = arguments[1].split('.')
  return keys.reduce((obj, key) => {
    return obj[key]
  }, arguments[0])
}
export function set () {
  arguments[0][arguments[1]] = arguments[2]
}


export function removeObject (arry, obj){
  let objI = arry.findIndex(ele=>ele.id===obj.id)
  if(objI === -1){
    return
  }
  return arry.splice(objI,1)
}