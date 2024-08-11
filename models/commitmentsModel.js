const mongoose = require('mongoose');

const commitmentSchema = new mongoose.Schema({
  AnashIdentifier: {
    type: String,
    ref: 'People',
    required: [true, 'Identity Number is required']
  },
  PersonID: {
    type: String,
    ref: 'People',
  },
  FirstName: {
    type: String,
    // required: [true, 'First Name is required']
  },
  LastName: {
    type: String,
    // required: [true, 'Last Name is required']
  },
  CommitmentAmount: {
    type: Number,
    // required: [true, 'Commitment Amount is required']
  },
  AmountPaid: {
    type: Number,
    // required: [true, 'Amount Paid is required']
  },
  AmountRemaining: {
    type: Number,
    // required: [true, 'Amount Remaining is required']
  },
  NumberOfPayments: {
    type: Number,
    // required: [true, 'Number of Payments is required']
  },
  PaymentsMade: {
    type: Number,
    // required: [true, 'Payments Made is required']
  },
  PaymentsRemaining: {
    type: Number,
    // required: [true, 'Payments Remaining is required']
  },
  Fundraiser: {
    type: String,
    // required: [true, 'Fundraiser is required']
  },
  PaymentMethod: {
    type: String,enum: ['Cash', 'Check', 'CreditCard','DirectDebitCredit','BankTransfer','DirectDebit'],
    // required: [true, 'Payment Method is required']
  },
  Notes: {
    type: String
  },
  ResponseToFundraiser: {
    type: String
  },
  // Campaign: {
  //   type: mongoose.Schema.Types.ObjectId,
  //   ref: 'Campaign'
  // }
});

const Commitment = mongoose.model('Commitment', commitmentSchema);

module.exports = Commitment;
