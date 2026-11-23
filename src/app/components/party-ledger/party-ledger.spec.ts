import { TestBed } from '@angular/core/testing';
import { PartyLedger } from './party-ledger';
import { DataService, Party } from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';

const party: Party = {
  id: 1,
  name: 'Test Party',
  companyName: '',
  type: 'Customer',
  total: 0,
  paid: 0,
  due: 500,
  status: 'Enabled',
  inHand: '',
  zone: '',
  email: '',
  phone: '01700000000',
  createdAt: '2026-11-11',
  address: ''
};

function setup() {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: DataService,
        useValue: {
          hydrated: () => true,
          voucherSettings: () => ({ businessNamePart1: 'SM', businessNamePart2: 'Enterprise', address: '', mobile: '' })
        }
      },
      { provide: SessionService, useValue: { log: () => undefined } },
      { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en, t: (key: string) => key } }
    ]
  });
  const fixture = TestBed.createComponent(PartyLedger);
  fixture.componentRef.setInput('party', party);
  fixture.componentRef.setInput('paymentOnly', true);
  fixture.detectChanges();
  return fixture;
}

describe('PartyLedger payment-only mode', () => {
  it('shows the payment form without the party profile drawer', () => {
    const text = (setup().nativeElement.textContent as string);

    expect(text).toContain('ledger.recordPayment');
    expect(text).toContain('Test Party');
    expect(text).not.toContain('Party Profile');
  });

  it('closes the whole overlay when the payment form is dismissed', () => {
    const fixture = setup();
    let closed = false;
    fixture.componentInstance.close.subscribe(() => { closed = true; });

    const cancel = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('common.cancel'));
    expect(cancel).toBeTruthy();
    cancel!.click();

    expect(closed).toBe(true);
  });
});
