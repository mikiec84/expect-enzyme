import elementToString from './element-to-string';
import getDisplayName from 'react-display-name';
import stringifyObject from 'stringify-object';
import deepEqual from 'deep-eql';
import React from 'react';

// Used to detect if an assertion is negated.
const NEGATION_FLAG = 'enzyme-assertion-is-negated';

/**
 * Returns whether the assertion is negated.
 * @param  {Expectation} ctx - The assertion context.
 * @return {Boolean} - Whether the assertion is negated.
 */
const isNegated = ctx => Boolean(ctx[NEGATION_FLAG]);

/**
 * Utility for asserting a statement is true.
 * @throws {Error}
 * @param  {Object} assertion - Assertion statements.
 * @param  {Boolean} statement - Whether your expectation was met.
 * @param  {String} msg - An error to throw if the statement fails.
 * @param  {Expectation} [ctx] - The current `this` value.
 * @return {undefined}
 */
const assert = ({ statement, ctx = {}, expected, actual, msg }) => {
  // Detect negated assertions.
  const negated = isNegated(ctx);
  const correct = Boolean(negated ? !statement : statement);

  // The assertion passed.
  if (correct) {
    return;
  }

  // Aids in formatting negation error messages.
  const not = negated ? 'not ' : '';

  // Support error expressions.
  const details = msg instanceof Function ? msg(not) : msg;

  // Nope, it failed.
  const error = new Error(details);

  error.expected = expected;
  error.actual = actual;

  throw error;
};

/**
 * Decorator - sets a negation flag before invoking an assertion.
 * @param  {String} methodName - The name of the assertion to invert.
 * @return {Function} - To be used as the assertion.
 */
const negate = methodName =>
  function() {
    this[NEGATION_FLAG] = true;
    const assertion = this[methodName];

    try {
      assertion.apply(this, arguments);
    } catch (error) {
      throw error;
    } finally {
      // Removes the flag, regardless of outcome.
      delete this[NEGATION_FLAG];
    }
  };

/**
 * Checks if the given value is an enzyme wrapper.
 * @param  {Any} actual - The value to check.
 * @return {Boolean} - Whether it's enzyme.
 */
const isEnzymeWrapper = actual => {
  if (!actual) {
    return false;
  }

  // Duck typed (instanceof can break if duplicate package instances exist).
  return Boolean(
    typeof actual.setState === 'function' &&
      typeof actual.findWhere === 'function' &&
      typeof actual.debug === 'function',
  );
};

/**
 * Throws an error if the given argument isn't an enzyme wrapper.
 * @param  {Any} actual - Preferably an enzyme wrapper.
 * @return {undefined}
 * @throws {Error} - If the type isn't enzyme.
 */
const assertIsEnzymeWrapper = actual =>
  assert({
    statement: isEnzymeWrapper(actual),
    msg: `${actual} is not an enzyme wrapper`,
  });

/**
 * Turns an enzyme selector into a printable string.
 * @param  {Function|String|Object} selector - An enzyme selector.
 * @return {String} - A loggable description of the selector.
 */
const stringifySelector = selector => {
  const type = typeof selector;

  // CSS selector?
  if (type === 'string') {
    return selector;
  }

  // Component instance selector?
  if (type === 'function') {
    return getDisplayName(selector);
  }

  // Nope, enzyme attribute selector.
  return stringifyObject(selector, {
    // Prevents newlines.
    inlineCharacterLimit: Infinity,
  });
};

/**
 * Only attempts an enzyme assertion if the given value is an enzyme wrapper.
 * @param  {Function} defaultAssertion - An expect assertion to overload.
 * @param  {Function} enzymeAssertion - An assertion handler for enzyme types.
 * @return {Function} - An assertion method.
 */
const addEnzymeSupport = (defaultAssertion, enzymeAssertion) =>
  function assertion() {
    // Is the value an enzyme wrapper?
    if (isEnzymeWrapper(this.actual)) {
      // Use the enzyme assertion.
      enzymeAssertion.apply(this, arguments);
    } else if (defaultAssertion) {
      return defaultAssertion.apply(this, arguments);
    }

    // There's no fallback assertion.
    assertIsEnzymeWrapper(this.actual);

    // Chain 'em assertions.
    return this;
  };

/**
 * Creates a new set of enzyme assertions overloading those provided.
 * @param  {Object} original - A collection of assertions to overload.
 * @return {Object} - The new assertions.
 */
export default original => ({
  /**
   * Assert a component has a property.
   * @param  {String} prop - An expected property.
   * @param  {Any} [value=true] - An expected value.
   * @return {this} - The current expect assertion.
   */
  toHaveProp: addEnzymeSupport(original.toHaveProp, function(prop, value) {
    assertIsEnzymeWrapper(this.actual);

    const actual = this.actual.props();
    const displayName = this.actual.name();
    const real = { [prop]: actual[prop] };
    const expected = { [prop]: value };

    if (!isNegated(this) || value === undefined) {
      assert({
        ctx: this,
        expected,
        actual: real,
        statement: actual.hasOwnProperty(prop),
        msg: not => `Expected ${displayName} to ${not}have prop "${prop}"`,
      });
    }

    if (value !== undefined) {
      assert({
        ctx: this,
        statement: deepEqual(actual[prop], value),
        expected,
        actual: real,
        msg: not => {
          const constructor = (value.constructor || {}).name || 'Object';
          const prettyValue =
            value instanceof Object ? `${constructor} {...}` : value;

          return `Expected ${displayName} property "${prop}" to ${not}be "${prettyValue}"`;
        },
      });
    }

    return this;
  }),

  /**
   * Asserts an element doesn't match the given prop. If no
   * value is specified, it asserts the prop doesn't exist at all.
   * @param  {String} prop - The expected prop.
   * @param  {Any} [value] - The value it shouldn't be.
   * @return {this} - The expectation context.
   */
  toNotHaveProp: addEnzymeSupport(original.toNotHaveProp, negate('toHaveProp')),

  /**
   * Verifies a component was given certain props.
   * @param  {Object} props - Expected props.
   * @return {this} - The current assertion.
   */
  toHaveProps: addEnzymeSupport(original.toHaveProps, function(props) {
    // Props should be an object.
    assert({
      statement: props instanceof Object,
      msg: `Method "toHaveProps()" expected a props object, was given "${props}"`,
    });

    // Make sure we're dealing with an enzyme wrapper.
    assertIsEnzymeWrapper(this.actual);

    // Check each expected prop.
    Object.keys(props).forEach(key => {
      const value = props[key];

      // Assert!
      this.toHaveProp(key, value);
    });
  }),

  /**
   * Assert an element does not contain a set of props.
   * @param  {Object} props - All the props which should not be contained.
   * @return {this} - The expectation context.
   */
  toNotHaveProps: addEnzymeSupport(
    original.toNotHaveProps,
    negate('toHaveProps'),
  ),

  /**
   * Asserts a component contains a css class.
   * @param  {String} className - The class the component should have.
   * @return {this} - The expectation context.
   */
  toHaveClass: addEnzymeSupport(original.toHaveClass, function(className) {
    const element = this.actual;

    // Only works for enzyme elements.
    assertIsEnzymeWrapper(element);
    const actual = element.prop('className')
      ? element.prop('className').split(' ')
      : [];

    let expected = String(className).split(' ');

    if (isNegated(this)) {
      // Reimagine `actual` without the classname.
      expected = actual.filter(value => value !== className);
    } else {
      expected.push(...actual);
    }

    assert({
      ctx: this,
      statement: element.hasClass(className),
      expected,
      actual,
      msg: not =>
        `Expected ${element.name()} to ${not}have class "${className}"`,
    });

    return this;
  }),

  /**
   * Asserts a component does not have a class name.
   * @param  {String} className - The class it really shouldn't have.
   * @return {this} - The expectation context.
   */
  toNotHaveClass: addEnzymeSupport(
    original.toNotHaveClass,
    negate('toHaveClass'),
  ),

  /**
   * Assert the element contains the given state.
   * @param  {Object} expectedState - State the component should contain.
   * @return {this} - The expectation context.
   */
  toHaveState: addEnzymeSupport(original.toHaveState, function(expectedState) {
    const element = this.actual;
    assertIsEnzymeWrapper(element);

    // Make sure the expected state is valid.
    assert({
      statement: expectedState instanceof Object,
      msg:
        'expect(...).toHaveState expects an object,' +
        ` was given "${expectedState}"`,
    });

    // Check every property in the expected state.
    Object.keys(expectedState).forEach(key => {
      const actual = element.state(key);
      const expected = expectedState[key];

      // Deeply check equivalence.
      assert({
        ctx: this,
        statement: deepEqual(actual, expected),
        expected,
        actual,
        msg: not => `Expected state "${key}" to ${not}equal ${expected}`,
      });
    });

    return this;
  }),

  /**
   * Asserts a component does not contain the given state.
   * @param  {Object} state - State it should definitely not contain.
   * @return {this} - The expectation context.
   */
  toNotHaveState: addEnzymeSupport(
    original.toNotHaveState,
    negate('toHaveState'),
  ),

  /**
   * Asserts a component matches the given element output.
   * @param  {Any} element - A valid react element.
   * @return {this} - The expectation context.
   */
  toHaveRendered: addEnzymeSupport(original.toHaveRendered, function(element) {
    const { actual } = this;
    const exists = Boolean(actual && actual.length);
    const testEquality = element !== undefined;
    const negated = isNegated(this);

    // `.toNotHaveRendered(...)` called on non-existent element.
    if (negated && !exists && testEquality) {
      assert({
        statement: false,
        msg: "Expected element not to match, but it didn't exist",
      });
    }

    // Handle cases where `.toHaveRendered()` was called with no args.
    if (!negated) {
      const unexpectedNull =
        !exists || testEquality ? false : actual.equals(null);

      assert({
        statement: exists && !unexpectedNull,
        msg: `Expected element to have rendered something`,
      });
    }

    if (negated && !testEquality) {
      assert({
        statement: !exists || actual.equals(null),
        msg: `Expected element to not have rendered anything`,
      });
    }

    // Being used as `.toExist()`.
    if (!testEquality) {
      return;
    }

    assert({
      ctx: this,
      statement: actual.equals(element),
      msg: not => {
        const isValidElement = React.isValidElement(element);
        const hasProps = isValidElement && Object.keys(element.props).length;

        // Show abbreviated element on one line.
        const expectedString = isValidElement
          ? elementToString(element)
          : `"${element}"`;

        const indent = hasProps ? '\n\t' : '';
        const colon = indent ? ':' : ' ';

        return (
          `Expected element to ${not}equal` +
          `${colon}${indent}${expectedString}`
        );
      },
    });
  }),

  /**
   * Asserts the given output doesn't match what your component rendered.
   * @param  {Any} element - A react element (or null) you expect to not match.
   * @return {this} - The expectation context.
   */
  toNotHaveRendered: addEnzymeSupport(
    original.toNotHaveRendered,
    negate('toHaveRendered'),
  ),

  /**
   * Asserts a component contains a given style.
   * @param  {String} property - A CSS property.
   * @param  {Any} [value] - The expected CSS value.
   * @return {this} - The expectation context.
   */
  toHaveStyle: addEnzymeSupport(original.toHaveStyle, function(
    property,
    value,
  ) {
    const element = this.actual;
    assertIsEnzymeWrapper(element);

    const style = element.prop('style') || {};
    const displayName = element.name();

    const styles =
      property instanceof Object
        ? property
        : {
            [property]: value,
          };

    Object.keys(styles).forEach(property => {
      const value = styles[property];

      // "value" parameter is optional.
      if (value === undefined) {
        // Make sure the property is specified.
        assert({
          ctx: this,
          statement: style.hasOwnProperty(property),
          msg: not =>
            `Expected ${displayName} to ${not}have css property "${property}"`,
        });
      } else {
        // Show what css is expected.
        const styleString = stringifyObject(
          { [property]: value },
          {
            inlineCharacterLimit: Infinity,
          },
        );

        // Make sure the value matches.
        assert({
          ctx: this,
          statement: style[property] === value,
          expected: styles,
          actual: style,
          msg: not =>
            `Expected ${displayName} to ${not}have css ${styleString}`,
        });
      }
    });

    return this;
  }),

  /**
   * Asserts an element does not have a set of styles.
   * @param  {String|Object} name - Either an object of styles
   * or the name of a style property.
   * @param  {Any} [value] - The style it shouldn't be.
   * @return {this} - The expectation context.
   */
  toNotHaveStyle: addEnzymeSupport(
    original.toNotHaveStyle,
    negate('toHaveStyle'),
  ),

  /**
   * Asserts a component has the given context.
   * @param  {Object} context - What you expect the context to equal.
   * @return {this} - The expectation context.
   */
  toHaveContext: addEnzymeSupport(
    original.toHaveContext,
    function toHaveContext(context) {
      const element = this.actual;
      assertIsEnzymeWrapper(element);

      const actual = element.context();

      Object.keys(context).forEach(property => {
        const expected = context[property];
        const expectedString = stringifyObject(expected, {
          inlineCharacterLimit: Infinity,
        });

        assert({
          ctx: this,
          statement: deepEqual(actual[property], expected),
          actual: actual[property],
          expected,
          msg: not =>
            'Expected context property' +
            ` "${property}" to ${not}equal ${expectedString}`,
        });
      });

      return this;
    },
  ),

  /**
   * Asserts a component does not have the given context.
   * @param  {Object} context - A set of key/value pairs it should exclude.
   * @return {this} - The expectation context.
   */
  toNotHaveContext: addEnzymeSupport(
    original.toNotHaveContext,
    negate('toHaveContext'),
  ),

  /**
   * Assert the type of an enzyme wrapper.
   * @param  {String|Function} type - The type you expect your element to be.
   * @return {this} - The expectation.
   */
  toBeA: addEnzymeSupport(original.toBeA, function(type) {
    // User-friendly component description.
    const displayName = getDisplayName(type);
    const element = this.actual;
    const { article = 'a' } = this;
    const name = element.name();

    // Check the type.
    assert({
      ctx: this,
      statement: element.is(type),
      expected: displayName,
      actual: name,
      msg: not =>
        `Expected ${element.name()} to ${not}be ${article} ${displayName}`,
    });
  }),

  /**
   * Same as `.toBeA(type)`, but with different wording.
   * @param  {String|Function} type - The type you expect your element to be.
   * @return {this} - The expectation context.
   */
  toBeAn: addEnzymeSupport(original.toBeAn, function(type) {
    // Set the correct article form.
    this.article = 'an';

    // Assert!
    this.toBeA(type);
  }),

  /**
   * Asserts the enzyme wrapper contains something.
   * @return {this} - The expectation context.
   */
  toExist: addEnzymeSupport(original.toExist, function() {
    assert({
      ctx: this,
      statement: this.actual.length > 0,
      msg: not => `Expected element to ${not}exist`,
    });
  }),

  /**
   * Asserts an element does not exist.
   * @return {this} - The expectation context.
   */
  toNotExist: addEnzymeSupport(original.toNotExist, negate('toExist')),

  /**
   * Assert the component is not a type.
   * @param  {String|Function} type
   * The type you expect your element not to be.
   * @return {this} - The expectation context.
   */
  toNotBeA: addEnzymeSupport(original.toNotBeA, negate('toBeA')),

  /**
   * Same as `.toNotBeA(type)`, but with different wording.
   * @param  {String|Function} type
   * The type you expect your element not to be.
   * @return {this} - The expectation context.
   */
  toNotBeAn: addEnzymeSupport(original.toNotBeAn, function(type) {
    // Correct grammar.
    this.article = 'an';

    // Throw us some errors!
    this.toNotBeA(type);
  }),

  /**
   * Assert a component contains a selector.
   * @param  {String|Function|Object} selector -
   * A selector your element should have.
   * @return {this} - The expectation context.
   */
  toContain: addEnzymeSupport(original.toContain, function(selector) {
    const element = this.actual;

    const isContained = element.find(selector).length > 0;
    const stringSelector = stringifySelector(selector);

    assert({
      ctx: this,
      statement: isContained,
      msg: not => `Expected element to ${not}contain "${stringSelector}"`,
    });
  }),

  /**
   * Asserts a component does not contain a selector.
   * @param  {String|Function|Object} selector -
   * A selector your component should not contain.
   * @return {this} - The expectation context.
   */
  toNotContain: addEnzymeSupport(original.toNotContain, negate('toContain')),
});
