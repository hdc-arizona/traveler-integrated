/* globals uki */

class Selection extends uki.utils.IntrospectableMixin(uki.Model) {
  constructor () {
    super(...arguments);
    this.id = Selection.NEXT_ID;
    Selection.NEXT_ID += 1;
  }

  /**
   * A short string that identifies the selection
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
Selection.NEXT_ID = 1;

export default Selection;
