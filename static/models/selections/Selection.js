/* globals uki */

class Selection extends uki.utils.IntrospectableMixin(uki.Model) {
  /**
   * A simple string that identifies the selection
   */
  get label () {
    throw new Error(`Selection class ${this.type} has not implemented the required label getter`);
  }

  /**
   * A string representation of the details of the current selection
   */
  get details () {
    throw new Error(`Selection class ${this.type} has not implemented the required details getter`);
  }
}

export default Selection;
