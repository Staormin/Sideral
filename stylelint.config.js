export default {
  extends: ['stylelint-config-standard'],
  overrides: [{ files: ['**/*.vue'], customSyntax: 'postcss-html' }],
  rules: {
    'selector-class-pattern': null,
    'custom-property-pattern': null,
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['deep', 'global', 'slotted'] },
    ],
    'no-descending-specificity': null,
    'declaration-property-value-no-unknown': [
      true,
      { ignoreProperties: { '/.*/': '/v-bind\\(/' } },
    ],
  },
}
