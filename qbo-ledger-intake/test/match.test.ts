import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameScore, bestCustomer, pickPaymentMethod, dice } from '../src/match.ts'

const customers = [
  { Id: '1439', DisplayName: 'Mitchell, Francine', GivenName: 'Francine', FamilyName: 'Mitchell' },
  { Id: '2', DisplayName: 'Gordon, Connie', GivenName: 'Connie', FamilyName: 'Gordon' },
  { Id: '3', DisplayName: 'Gordon, Carol', GivenName: 'Carol', FamilyName: 'Gordon' },
  { Id: '4', DisplayName: 'Williams, Coralita' },
  { Id: '5', DisplayName: 'Natasha Gittins' },
  { Id: '6', DisplayName: 'Morgan, Juanita' },
]

test('ledger "First Last" matches QuickBooks "Last, First" exactly', () => {
  assert.equal(nameScore('Francine', 'Mitchell', customers[0]!), 1)
  assert.equal(nameScore('Coralita', 'Williams', customers[3]!), 1)
})

test('nickname with the same last name scores as uncertain, not exact', () => {
  const s = nameScore('Fran', 'Mitchell', customers[0]!)
  assert.ok(s > 0.75 && s < 0.9, `got ${s}`)
})

test('two customers with the same last name are told apart by first name', () => {
  const [best, second] = bestCustomer({ first_name: 'Connie', last_name: 'Gordon' }, customers)
  assert.equal(best!.customer.Id, '2')
  assert.ok(second!.score < 0.9)
})

test('misspelled last name still finds the customer via fuzzy match, below auto threshold', () => {
  const [best] = bestCustomer({ first_name: 'Natasha', last_name: 'Gittens' }, customers)
  assert.equal(best!.customer.Id, '5')
  assert.ok(best!.score > 0.65 && best!.score < 0.9, `got ${best!.score}`)
})

test('unknown person does not match anyone strongly', () => {
  const m = bestCustomer({ first_name: 'Dorothy', last_name: 'Powell' }, customers)
  assert.ok(!m.length || m[0]!.score < 0.65)
})

test('payment method synonyms map to the QuickBooks list', () => {
  const methods = [{ Id: 'a', Name: 'Cash' }, { Id: 'b', Name: 'Check' }, { Id: 'c', Name: 'Zelle' }, { Id: 'd', Name: 'Visa' }, { Id: 'e', Name: 'PayPal' }]
  assert.equal(pickPaymentMethod('zelle', methods)!.Id, 'c')
  assert.equal(pickPaymentMethod('check', methods)!.Id, 'b')
  assert.equal(pickPaymentMethod('credit_card', methods)!.Id, 'd')
  assert.equal(pickPaymentMethod('paypal', methods)!.Id, 'e')
  assert.equal(pickPaymentMethod('unknown', methods), null)
  assert.equal(pickPaymentMethod('money_order', methods), null)
})

test('dice similarity is symmetric and bounded', () => {
  assert.equal(dice('abc', 'abc'), 1)
  assert.equal(dice('abc', 'xyz'), 0)
  assert.equal(dice('Lobsterfest', 'lobster fest'), dice('lobster fest', 'Lobsterfest'))
})
