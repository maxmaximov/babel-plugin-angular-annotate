export default function ({ Plugin, types: t }) {
  return new Plugin('angular-annotate', {
    visitor: {
      CallExpression(node) {
        if (this.get('callee').get('object').get('callee').matchesPattern('angular.module')) {
          if (this.get('callee').get('property').isIdentifier({ name: 'controller' })) {
            let func = this.get('arguments')[1];
            let varLiterals = func.node.params.map(i => t.literal(i.name));
            varLiterals.push(func.node);
            func.replaceWith(
              t.arrayExpression(varLiterals)
            );
          }
        }
      }
    }
  });
}