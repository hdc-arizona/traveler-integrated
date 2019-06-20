const IntrospectableMixin = function (superclass) {
  const Introspectable = class extends superclass {
    get type () {
      return this.constructor.type;
    }
    get lowerCamelCaseType () {
      return this.constructor.lowerCamelCaseType;
    }
    get humanReadableType () {
      return this.constructor.humanReadableType;
    }
  };
  Object.defineProperty(Introspectable, 'type', {
    // This can / should be overridden by subclasses that follow a common string
    // pattern, such as RootToken, KeysToken, ParentToken, etc.
    configurable: true,
    get () { return this.name; }
  });
  Object.defineProperty(Introspectable, 'lowerCamelCaseType', {
    get () {
      const temp = this.type;
      return temp.replace(/./, temp[0].toLocaleLowerCase());
    }
  });
  Object.defineProperty(Introspectable, 'humanReadableType', {
    get () {
      // CamelCase to Sentence Case
      return this.type.replace(/([a-z])([A-Z])/g, '$1 $2');
    }
  });
  Introspectable.prototype._instanceOfIntrospectableMixin = true;
  return Introspectable;
};
Object.defineProperty(IntrospectableMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfIntrospectableMixin
});
export default IntrospectableMixin;
