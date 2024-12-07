const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  AnashIdentifier: {
    type: String,
    ref: 'People',
    required: [true, 'Identity Number is required']
  },
  FirstName: {
    type: String,
    default: '',

  },
  LastName: {
    type: String,
    default: '',
  },
  CommitmentId:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Commitment',
    required: [true, 'CommitmentId Number is required']
  },
  Amount: {
    type: Number,
    required: [true, 'Amount Number is required']
  },
  PaymentMethod: {
    type: String,
    enum:  ['מזומן', 'שיקים','העברה בנקאית',
      'הבטחה','משולב','כרטיס אשראי','שיקים','לא סופק','הוראת קבע','אשראי הו"ק','קיזוז','החזר תשלום'],
    required: [true, 'PaymentMethod is required']
  },
  CampainName: {
    type: String,
    ref: 'Campaign'
  },
  Date: {
    type: Date,
    required: [true, 'Date is required']
  }
});

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
