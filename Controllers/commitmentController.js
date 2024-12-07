const asyncHandler = require("express-async-handler");
const commitmentsModel = require("../models/commitmentsModel");
const campainModel = require("../models/campaignModel");
const paymentModel = require("../models/paymentModel");
const People = require("../models/peopleModel");
const pettyCash = require("../models/pettyCashModel");
const AppError = require("../utils/AppError");

const {
  recordAddOperation,
  recordNewPaymentOperation,
  recordDeleteOperation,
  recordEditOperation,
} = require("../utils/RecordOperation");
const { default: mongoose } = require("mongoose");
const validPaymentMethods = [
  'מזומן', , 'העברה בנקאית', 'הבטחה',
  'משולב', 'כרטיס אשראי', 'שיקים', 'לא סופק',
  'הוראת קבע', 'אשראי הו"ק', 'קיזוז', 'החזר תשלום'
];

const negativeValidPaymentMethods = [
  'הוראת קבע', 'אשראי הו"ק'
];


const validateCommitmentFields = (commitment, isUpdate) => {
  // Convert to numbers to avoid issues with string-based inputs
  commitment.CommitmentAmount = Number(commitment.CommitmentAmount);
  commitment.AmountPaid = Number(commitment.AmountPaid ?? 0);  // Default to 0 if falsy
  commitment.PaymentsMade = Number(commitment.PaymentsMade ?? 0);  // Default to 0 if falsy
  commitment.NumberOfPayments = Number(commitment.NumberOfPayments);
  if (isUpdate) {
    commitment.AmountRemaining = Number(commitment.AmountRemaining ?? commitment.CommitmentAmount);  // Default to CommitmentAmount if falsy
    commitment.PaymentsRemaining = Number(commitment.PaymentsRemaining ?? commitment.NumberOfPayments);  // Default to NumberOfPayments if falsy
  }
  else {
    commitment.AmountRemaining = Number(commitment.AmountRemaining || commitment.CommitmentAmount);  // Default to CommitmentAmount if falsy
    commitment.PaymentsRemaining = Number(commitment.PaymentsRemaining || commitment.NumberOfPayments);  // Default to NumberOfPayments if falsy

  }

  // Check for invalid CommitmentAmount or NumberOfPayments
  if (commitment.CommitmentAmount <= 0) {
    return "סכום התחייבות שנותר לא תקין";
  }
  if (commitment.NumberOfPayments && commitment.NumberOfPayments <= 0) {
    return "מספר התשלומים לא תקין";
  }

  // Check for negative AmountRemaining or PaymentsRemaining
  if (commitment.AmountRemaining < 0) {
    return 'סכום שנותר לתשלום אינו יכול להיות שלילי.';
  }
  if (commitment.PaymentsRemaining < 0) {
    return 'סכום שנותר לתשלומים אינו יכול להיות שלילי.';
  }

  // Check if CommitmentAmount is not less than AmountPaid
  if (commitment.CommitmentAmount < commitment.AmountPaid) {
    return "סכום התחייבות לא יכול להיות קטן מסכום התחייבות שנותר.";
  }

  // Check if NumberOfPayments is not less than PaymentsMade
  if (commitment.NumberOfPayments && commitment.NumberOfPayments < commitment.PaymentsMade) {
    return "מספר התשלומים לא יכול להיות קטן ממספר התשלומים שנותרו.";
  }

  // Check if the remaining amount matches the difference between CommitmentAmount and AmountPaid
  if (commitment.CommitmentAmount - commitment.AmountPaid != commitment.AmountRemaining) {
    return " סכום שנותר לתשלום לא תקין";
  }

  // Check if the remaining payments match the difference between NumberOfPayments and PaymentsMade
  if (commitment.NumberOfPayments && commitment.NumberOfPayments - commitment.PaymentsMade != commitment.PaymentsRemaining) {
    return " מספר התשלומים שנותרו לא תקין";
  }

  return null;  // Return null if all validations pass
};






exports.reviewCommitments = asyncHandler(async (req, res, next) => {
  let commitments = Array.isArray(req.body) ? req.body : [req.body];
  const { campainName } = req.query;
  const invalidCommitments = [];
  let validCommitments = [];

  const activePeople = await People.find({ isActive: true });
  const activePeopleMap = new Map(
    activePeople.map((person) => [person.AnashIdentifier, person])
  );

  // Filter out and enrich valid commitments
  const enrichedCommitments = commitments.map((commitment) => {
    if (!commitment.AnashIdentifier) {
      return { ...commitment, reason: "מזהה אנש לא סופק" };
    }
    commitment.AnashIdentifier = String(commitment.AnashIdentifier);

    const person = activePeopleMap.get(commitment.AnashIdentifier);

    if (!person) {
      return { ...commitment, reason: "מזהה אנש לא קיים במערכת או לא פעיל" };
    }

    commitment.FirstName = person.FirstName || commitment.FirstName;
    commitment.LastName = person.LastName || commitment.LastName;
    commitment.PersonID = person.PersonID || commitment.PersonID;

    if (!commitment.CampainName && !campainName) {
      return { ...commitment, reason: "שם קמפיין לא סופק" };
    }
    if (campainName && commitment.CampainName && commitment.CampainName !== campainName) {
      return { ...commitment, reason: "שם קמפיין לא תואם לדף הקמפיין" };
    }
    if (!commitment.CommitmentAmount || commitment.CommitmentAmount <= 0)
      return { ...commitment, reason: "סכום התחייבות לא תקין" };
    if (!commitment.PaymentMethod || !validPaymentMethods.includes(commitment.PaymentMethod)) {
      return { ...commitment, reason: "אופן התשלום לא תקין" };
    }

    return commitment;
  });

  const filteredCommitments = enrichedCommitments.filter((commitment) => {
    if (commitment.reason) {
      invalidCommitments.push(commitment);
      return false;
    }
    return true;
  });

  const uniqueCampaignNames = [
    ...new Set(filteredCommitments.map((c) => c.CampainName)),
  ];
  const allCampaigns = await campainModel.find({
    CampainName: { $in: uniqueCampaignNames },
  });
  const campaignMap = new Map(
    allCampaigns.map((campaign) => [campaign.CampainName, campaign])
  );

  const allExistingCommitments = await commitmentsModel.find({
    AnashIdentifier: { $in: filteredCommitments.map((c) => c.AnashIdentifier) },
    CampainName: { $in: uniqueCampaignNames },
  });

  const seenCommitments = new Set();

  for (const commitment of filteredCommitments) {
    const campaign = campaignMap.get(commitment.CampainName);
    if (!campaign) {
      invalidCommitments.push({
        ...commitment,
        reason: "קמפיין לא קיים במערכת",
      });
      continue;
    }

    const isExisting = allExistingCommitments.some((existing) => {

      // Directly return the result of the condition
      return existing.AnashIdentifier === commitment.AnashIdentifier &&
        existing.CampainName === commitment.CampainName;
    });

    if (isExisting) {
      invalidCommitments.push({
        ...commitment,
        reason: "התחייבות כבר קיימת במערכת",
      });
      continue;
    }

    const fieldError = validateCommitmentFields(commitment, false);
    if (fieldError !== null) {
      invalidCommitments.push({ ...commitment, reason: fieldError });
      continue;
    }

    // Create a unique key for `AnashIdentifier` and `CampainName`
    const uniqueKey = `${commitment.AnashIdentifier}-${commitment.CampainName}`;

    if (seenCommitments.has(uniqueKey)) {
      invalidCommitments.push({
        ...commitment,
        reason: "התחייבות כפולה עם אותו אנש ואותו שם קמפיין",
      });
      continue;
    }
    if (commitment.PaymentMethod && !validPaymentMethods.includes(commitment.PaymentMethod)) {
      invalidCommitments.push({
        ...commitment,
        reason: "אופן התשלום לא תקין",
      });
      continue;
    }



    seenCommitments.add(uniqueKey);
    validCommitments.push(commitment);
  }

  res.status(200).json({
    status: "success",
    validCommitments,
    invalidCommitments,
  });
});
exports.updateCommitmentDetails = asyncHandler(async (req, res, next) => {
  const commitment = req.body;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const person = await People.findOne({
      AnashIdentifier: commitment.AnashIdentifier,
      isActive: true,
    }).session(session);

    if (!person)
      throw new AppError(400, "מזהה אנש לא קיים במערכת או לא פעיל");

    const exsitCommitment = await commitmentsModel.findById(commitment._id).session(session);
    if (!exsitCommitment)
      throw new AppError(400, "התחייבות לא נמצאה");

    if (!commitment.CommitmentAmount || commitment.CommitmentAmount <= 0)
      throw new AppError(400, "סכום התחייבות לא תקין");

    const campain = await campainModel.findOne({ CampainName: commitment.CampainName }).session(session);
    if (!campain)
      throw new AppError(400, "קמפיין לא זוהה");

    const amountPerMemorialDay = campain.minimumAmountForMemorialDay;
    if (commitment.CommitmentAmount < amountPerMemorialDay * commitment.MemorialDays.length)
      throw new AppError(400, "סכום ההתחייבות אינו מספיק למספר ימי ההנצחה");

    const fieldError = validateCommitmentFields(commitment, true);
    if (fieldError) throw new AppError(400, fieldError);

    const recordedOperation = recordEditOperation({
      UserFullName: req.user?.FullName,
      Date: new Date(),
      OperationType: "עריכה",
      Desc: `עריכת התחייבות מקמפיין ${commitment.CampainName}`,
      OldValues: exsitCommitment,
      NewValues: commitment,
    });

    // Update the People record
    if (recordedOperation) {
      await People.findOneAndUpdate(
        { AnashIdentifier: commitment.AnashIdentifier },
        {
          $push: {
            CommitmentsOperations: {
              $each: [recordedOperation],
              $slice: -20,
            },
          },
        },
        { session }
      );
    }

    // Update the Commitment
    const updatedCommitment = await commitmentsModel.findOneAndUpdate(
      { _id: commitment._id },
      { $set: commitment },
      { new: true, session }
    );

    if (!updatedCommitment)
      throw new AppError(404, "התחייבות לא נמצאה");

    // Commit the transaction
    await session.commitTransaction();
    res.status(200).json({
      status: "success",
      updatedCommitment,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
});













exports.uploadCommitments = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const commitments = Array.isArray(req.body) ? req.body : [req.body];

    // Insert commitments within the transaction
    const uploadedCommitments = await commitmentsModel.insertMany(commitments, { session });

    if (!uploadedCommitments?.length) {
      throw new AppError("Commitments not uploaded", 404);
    }

    const anashIdentifiers = uploadedCommitments.map(commitment => commitment.AnashIdentifier);

    // Find all the people with matching AnashIdentifiers (within the transaction)
    const people = await People.find({ AnashIdentifier: { $in: anashIdentifiers } }).session(session);

    // Prepare the bulk updates for people who need to update their campaigns array
    const bulkUpdates = [];

    for (const commitment of uploadedCommitments) {
      const { AnashIdentifier, CampainName } = commitment;

      const person = people.find(p => p.AnashIdentifier === AnashIdentifier);

      if (person) {
        // Prepare the operation to record
        const recordedOperation = recordAddOperation({
          OperationType: `הוספה`,
          Desc: `הוספת תחייבות לקמפיין ${CampainName} בסך ${commitment.CommitmentAmount} ש"ח`,
          Data: commitment,
          Date: new Date(),
          UserFullName: req.user?.FullName
        });

        const update = {
          $push: {
            Campaigns: CampainName,
            CommitmentsOperations: {
              $each: [recordedOperation],
              $slice: -20,
            },
          },
        };

        // Add the update operation to the bulkUpdates array
        bulkUpdates.push({
          updateOne: {
            filter: { AnashIdentifier },
            update,
          },
        });
      }
    }

    // Execute all the updates in a single batch operation within the transaction
    if (bulkUpdates.length > 0) {
      await People.bulkWrite(bulkUpdates, { session });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "success",
      uploadedCommitments,
    });
  } catch (error) {
    // Roll back the transaction in case of error
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
});

function validatePaymentFields(paymentAmount, commitment) {
  // Convert fields to numbers (in case they are strings or undefined)
  const amountPaid = Number(commitment.AmountPaid ?? 0);
  const commitmentAmount = Number(commitment.CommitmentAmount ?? 0);
  const paymentsMade = Number(commitment.PaymentsMade ?? 0);
  const paymentsRemaining = Number(commitment.PaymentsRemaining ?? 0);
  const numberOfPayments = Number(commitment.NumberOfPayments ?? 0);
  console.log(paymentAmount)

  // Updated values
  const updatedAmountPaid = amountPaid + paymentAmount;
  const updatedAmountRemaining = commitmentAmount - updatedAmountPaid;
  const updatedPaymentsMade = paymentAmount > 0 ? paymentsMade + 1 : paymentsMade - 1;
  const updatedPaymentsRemaining = paymentAmount > 0 ? paymentsRemaining - 1 : paymentsRemaining + 1;

  console.log(updatedAmountRemaining);

  // Validation checks
  if (updatedAmountPaid > commitmentAmount) {
    return "סך התשלום חורג מסכום ההתחייבות";
  }
  if (updatedAmountRemaining < 0) {
    return 'סכום התשלום שנותר קטן מ-0';
  }
  if (updatedAmountRemaining > commitmentAmount) {
    return 'הסכום שנותר לתשלום לא יכול לחרוג מסכום ההתחייבות';
  }
  if (numberOfPayments && updatedPaymentsMade > numberOfPayments) {
    return 'מספר התשלומים בפועל לא יכול לעלות על מספר התשלומים הכולל';
  }
  if (numberOfPayments && updatedPaymentsRemaining < 0) {
    return 'מספר התשלומים הנותרים לא יכול להיות פחות מאפס';
  }
  if (numberOfPayments && updatedPaymentsRemaining > numberOfPayments) {
    return 'מספר התשלומים שנותרו גדול מסך התשלומים';
  }

  return null;  // No errors, validation passed
}




exports.reviewCommitmentPayments = async (req, res, next) => {
  let paymentsData = Array.isArray(req.body.data) ? req.body.data : [req.body.data];
  let campainName = req.body.campainName;
  const validPayments = [];
  const invalidPayments = [];
  const activePeople = await People.find({ isActive: true });
  const activePeopleMap = new Map(
    activePeople.map((person) => [person.AnashIdentifier, person])

  );

  const enrichedPayments = paymentsData.map((payment) => {
    if (!payment.AnashIdentifier) {
      return { ...payment, reason: " מזהה אנש לא סופק" };
    }
    payment.AnashIdentifier = String(payment.AnashIdentifier);

    const person = activePeopleMap.get(payment.AnashIdentifier);

    if (!person) {
      return { ...payment, reason: " מזהה אנש לא קיים במערכת או לא פעיל " };
    }
    if (!payment.CampainName && !campainName) {
      console.log(payment.CampainName);
      return { ...payment, reason: "שם קמפיין לא סופק" };
    }
    payment.CampainName = payment.CampainName || campainName;

    if (!payment.Amount) {
      return { ...payment, reason: "סכום התשלום לא סופק" };
    }
    if (payment.Amount == 0) {
      return { ...payment, reason: "סכום התשלום לא יכול להיות 0" };
    }
    if (!payment.PaymentMethod || !validPaymentMethods.includes(payment.PaymentMethod)) {
      return { ...payment, reason: "אופן התשלום לא תקין" };
    }
    if(payment.PaymentMethod === 'מזומן' && payment.Amount < 0)
    {
      return { ...payment, reason: "אין אפשרות לביצוע החזר מזומן בקבצים (רק באופן ידני באתר)"};
    }
    payment.FirstName = person.FirstName || payment.FirstName;
    payment.LastName = person.LastName || payment.LastName;


    return payment;
  });








  const filteredPayments = enrichedPayments.filter((payment) => {
    if (payment.reason) {
      invalidPayments.push(payment);
      return false;
    }
    return true;
  });
  // const uniqueCampaignNames = [...new Set(filteredPayments.map(p => p.CampainName))];
  const allCampaigns = await campainModel.find();
  const campaignMap = new Map(allCampaigns.map((campaign) => [campaign.CampainName, campaign]));
  const commitments = await commitmentsModel.find();



  for (const payment of filteredPayments) {
    const paymentCampain = campaignMap.get(payment.CampainName);
    if (!paymentCampain) {
      invalidPayments.push({
        ...payment,
        reason: "שם קמפיין לא קיים במערכת",
      });
      continue;
    }
    const commitment = getCommitmentOfPayment(payment, commitments);
    if (!commitment) {
      invalidPayments.push({
        ...payment,
        reason: "התחייבות לא קיימת במערכת",
      });
      continue;
    }
    const fieldError = validatePaymentFields(payment.Amount, commitment);
    if (fieldError) {
      invalidPayments.push({
        ...payment,
        reason: fieldError,
      });
      continue;
    }
    validPayments.push(payment);
  }
  res.status(200).json({
    status: "success",
    validPayments,
    invalidPayments,
  });
}

exports.uploadPayments = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Extract the payments from the request body
    const payments = Array.isArray(req.body) ? req.body : [req.body];

    // Get all unique commitment IDs from the payments
    const commitmentIds = [...new Set(payments.map(payment => payment.CommitmentId))];

    // Fetch all relevant commitments in a single query (within the session)
    const relevantCommitments = await commitmentsModel.find({
      _id: { $in: commitmentIds }
    }).session(session);

    // Create a map for faster commitment lookup
    const commitmentMap = new Map(
      relevantCommitments.map(commitment => [commitment._id.toString(), commitment])
    );

    // Get all relevant people based on the AnashIdentifiers from the commitments
    const anashIdentifiers = relevantCommitments.map(commitment => commitment.AnashIdentifier);

    // Fetch all people in one query using the AnashIdentifiers
    const people = await People.find({
      AnashIdentifier: { $in: anashIdentifiers }
    }).session(session);

    // Create a map for faster person lookup
    const peopleMap = new Map(
      people.map(person => [person.AnashIdentifier, person])
    );

    // Prepare commitments to update and valid payments to insert
    const commitmentsToUpdate = new Map();
    const validPayments = [];
    const peopleBulkUpdates = [];
    const pettyCashInsertions = [];
    const pettyCashDeletions = [];


    for (const payment of payments) {
      const commitment = commitmentMap.get(payment.CommitmentId.toString());

      if (commitment) {
        // Prepare payment for insertion
        payment.CommitmentId = commitment._id;
        validPayments.push(payment);

        // Aggregate updates for each commitment
        if (!commitmentsToUpdate.has(commitment._id.toString())) {
          commitmentsToUpdate.set(commitment._id.toString(), {
            _id: commitment._id,
            PaymentsRemaining: commitment.PaymentsRemaining,
            AmountRemaining: commitment.AmountRemaining,
            AmountPaid: commitment.AmountPaid,
            PaymentsMade: commitment.PaymentsMade,
            NumberOfPayments: commitment.NumberOfPayments
          });
        }

        const updateData = commitmentsToUpdate.get(commitment._id.toString());
        updateData.AmountRemaining -= payment.Amount;
        updateData.AmountPaid += payment.Amount;
        updateData.PaymentsRemaining = updateData.NumberOfPayments ? payment.Amount > 0 ? updateData.PaymentsRemaining - 1 : updateData.PaymentsRemaining + 1 : updateData.PaymentsRemaining;
        updateData.PaymentsMade = payment.Amount > 0 ? updateData.PaymentsMade + 1 : updateData.PaymentsMade - 1

        // Lookup the person using the optimized map
        const person = peopleMap.get(commitment.AnashIdentifier);

        if (person) {


          if (payment.PaymentMethod === "מזומן"&& payment.Amount > 0) {
            const fullName = `${commitment.FirstName} ${commitment.LastName}`;
            const { Amount, AnashIdentifier, Date: paymentDate } = payment;
            const Type = "הכנסה";
            pettyCashInsertions.push({
              FullNameOrReasonForIssue: fullName,
              AnashIdentifier: AnashIdentifier,
              TransactionType: Type,
              Amount: Amount,
              TransactionDate: paymentDate,
              PaymentId: payment._id
            });
          }

           

      
          // Record the payment operation for this person
          const recordedOperation = recordAddOperation({
            OperationType: "הוספה", // Operation type in Hebrew (Payment for commitment)
            Data: payment, // Payment details
            Desc: `הוספת תשלום להתחייבות ${commitment.CampainName} בסך ${payment.Amount} ש"ח`,
            Date: new Date(), // Current date and time
            UserFullName: req.user?.FullName // User triggering the operation
          });

          const update = {
            $push: {
              PaymentsOperations: {
                $each: [recordedOperation],
                $slice: -20,
              },
            },
          };

          peopleBulkUpdates.push({
            updateOne: {
              filter: { _id: person._id },
              update,
            },
          });
        }
      }

     
    }



    // If no valid payments, return an error
    if (validPayments.length === 0) {
      throw new AppError(404, "No valid payments to upload");
    }

    const bulkUpdates = Array.from(commitmentsToUpdate.values()).map(updateData => ({
      updateOne: {
        filter: { _id: updateData._id },
        update: {
          $set: {
            PaymentsRemaining: updateData.PaymentsRemaining,
            AmountRemaining: updateData.AmountRemaining,
            AmountPaid: updateData.AmountPaid,
            PaymentsMade: updateData.PaymentsMade
          }
        }
      }
    }));

    if (pettyCashInsertions.length > 0) {
      await pettyCash.insertMany(pettyCashInsertions, { session });
    }
    // Insert valid payments into the paymentModel collection
    await paymentModel.insertMany(validPayments, { session });



    // Execute bulk updates for commitments
    await commitmentsModel.bulkWrite(bulkUpdates, { session });

    await People.bulkWrite(peopleBulkUpdates, { session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: "Payments uploaded successfully" });
  }
  catch (error) {
    // Roll back the transaction in case of error
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
});


exports.uploadCommitmentPayment = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession(); // Start a session for the transaction
  session.startTransaction(); // Begin the transaction

  try {
    const payment = req.body;
    const person = await People.findOne({ AnashIdentifier: payment.AnashIdentifier, isActive: true }).session(session);

    if (!person) {
      return next(new AppError(400, 'מזהה אנש לא קיים במערכת או לא פעיל'));
    }

    if (!payment) {
      return next(new AppError(400, 'לא נשלח תשלום'));
    }
    if (!payment.PaymentMethod || !validPaymentMethods.includes(payment.PaymentMethod)) {
      return next(new AppError(400, ' אופן תשלום לא תקין '));
    }

    const commitment = await commitmentsModel.findOne({
      AnashIdentifier: payment.AnashIdentifier,
      CampainName: payment.CampainName
    }).session(session);

    if (!commitment) {
      return next(new AppError(400, 'התחייבות לא קיימת במערכת'));
    }

    payment.CommitmentId = commitment._id;
    const fieldError = validatePaymentFields(payment.Amount, commitment);
    if (fieldError) {
      return next(new AppError(400, fieldError));
    }

    // Create the payment
    const newPayment = await paymentModel.create([payment], { session }); // Pass session to ensure it's part of the transaction
    console.log(commitment);


    // Update the commitment fields
    commitment.AmountPaid += parseFloat(payment.Amount);
    commitment.AmountRemaining -= parseFloat(payment.Amount);
    commitment.PaymentsRemaining = commitment.NumberOfPayments ? payment.Amount > 0 ? commitment.PaymentsRemaining - 1 : commitment.PaymentsRemaining + 1 : commitment.PaymentsRemaining;
    commitment.PaymentsMade = payment.Amount > 0 ? commitment.PaymentsMade + 1 : commitment.PaymentsMade - 1

    // Save the updated commitment
    const updatedCommitment = await commitment.save({ session });



    if (payment?.PaymentMethod === "מזומן") {

      if (payment?.Amount > 0) {

        const fullName = `${commitment.FirstName} ${commitment.LastName}`;
        const { Amount, AnashIdentifier, Date: paymentDate } = payment;
        const Type = "הכנסה";
        const Transaction = {
          FullNameOrReasonForIssue: fullName,
          AnashIdentifier: AnashIdentifier,
          Amount: Amount,
          TransactionDate: paymentDate,
          TransactionType: Type,
          PaymentId: newPayment[0]._id
        };
        const CreatedTransaction = await pettyCash.create([Transaction], { session });
      }
      else {
        const paymentInPettyCash = await pettyCash.findOne({ AnashIdentifier: AnashIdentifier, Amount: -payment.Amount, TransactionType: "הכנסה" }).session(session);
        if (paymentInPettyCash) {
          await pettyCash.findOneAndDelete({ PaymentId: payment._id }, { session })
        }
        else {
          return next(new AppError(400, 'תשלום לא קיים בקופה קטנה'));
        }


      }



    }

    const recordedOperation = recordAddOperation({
      OperationType: payment.Amount > 0 ? "הוספה" : "מחיקה",
      Desc: payment.Amount > 0 ? "הוספת תשלום להתחייבות לקמפיין " + commitment.CampainName + " סך תשלום " + payment.Amount + " ש" + "ח" : "החזר תשלום",
      Data: payment, // Payment details
      Date: new Date(), // Current date and time
      UserFullName: req.user?.FullName // User triggering the operation
    });

    // Add the recorded operation to the person's PaymentsOperations array
    await People.updateOne(
      { AnashIdentifier: commitment.AnashIdentifier },
      {
        $push: {
          PaymentsOperations: {
            $each: [recordedOperation],
            $slice: -20, // Limit to the latest 20 operations
          }
        }
      },
      { session }
    );




    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "success",
      newPayment: newPayment[0],
      updatedCommitment,
    });
  } catch (error) {
    // Abort the transaction in case of error
    await session.abortTransaction();
    session.endSession();
    return next(new AppError(500, "Transaction failed: " + error.message));
  }
});
function validateDeletePaymentFields(paymentAmount,commitment) {
    const amountPaid = Number(commitment.AmountPaid ?? 0);
    const commitmentAmount = Number(commitment.CommitmentAmount ?? 0);
    const paymentsMade = Number(commitment.PaymentsMade ?? 0);
    const paymentsRemaining = Number(commitment.PaymentsRemaining ?? 0);
    const numberOfPayments = Number(commitment.NumberOfPayments ?? 0);
    console.log(paymentAmount)
    console.log(amountPaid)
  
    // Updated values
    const updatedAmountPaid = amountPaid - paymentAmount;
    const updatedAmountRemaining = commitmentAmount - updatedAmountPaid;
    const updatedPaymentsMade = paymentAmount > 0 ? paymentsMade - 1 : paymentsMade + 1;
    const updatedPaymentsRemaining = paymentAmount > 0 ? paymentsRemaining + 1 : paymentsRemaining - 1;
  
  
    // Validation checks
    if (updatedAmountPaid > commitmentAmount) {
      return "סך התשלום חורג מסכום ההתחייבות";
    }
    if (updatedAmountRemaining < 0) {
      return 'סכום התשלום שנותר קטן מ-0';
    }
    if (updatedAmountRemaining > commitmentAmount) {
      return 'הסכום שנותר לתשלום לא יכול לחרוג מסכום ההתחייבות';
    }
    if (numberOfPayments && updatedPaymentsMade > numberOfPayments) {
      return 'מספר התשלומים בפועל לא יכול לעלות על מספר התשלומים הכולל';
    }
    if (numberOfPayments && updatedPaymentsRemaining < 0) {
      return 'מספר התשלומים הנותרים לא יכול להיות פחות מאפס';
    }
    if (numberOfPayments && updatedPaymentsRemaining > numberOfPayments) {
      return 'מספר התשלומים שנותרו גדול מסך התשלומים';
    }
  
    return null;  // No errors, validation passed
  
  
}
exports.deletePayment = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession(); // Start a transaction session
  session.startTransaction(); // Begin the transaction

  try {
    const paymentId = req.params.paymentId;

    const payment = await paymentModel.findById(paymentId).session(session);
    // console.log(payment);
    if (!payment) {
      return next(new AppError(404, 'לא נמצא תשלום במערכת'));
    }

    const person = await People.findOne({ AnashIdentifier: payment.AnashIdentifier, isActive: true }).session(session);
    if (!person) {
      return next(new AppError(404, "מזהה אנש לא קיים במערכת או לא פעיל "));
    }

    const commitment = await commitmentsModel.findById(payment.CommitmentId).session(session);
    if (!commitment) {
      return next(new AppError(404, "התחייבות לא קיימת במערכת"));
    }

    // Delete the payment
    const validateDeletedPaymentError = validateDeletePaymentFields(payment.Amount, commitment);
    if (validateDeletedPaymentError) {
      return next(new AppError(400, validateDeletedPaymentError));
    }
    const deletedPayment = await paymentModel.findByIdAndDelete(paymentId, { session });

    if (!deletedPayment) {
      return next(new AppError(500, "שגיאה במחיקת התשלום"));
    }

    // Update the associated commitment
    commitment.AmountPaid =
      commitment.AmountPaid - parseFloat(payment.Amount)


    commitment.AmountRemaining =
      commitment.AmountRemaining + parseFloat(payment.Amount)


    commitment.PaymentsMade =
      payment.Amount > 0 ? commitment.PaymentsMade - 1 : commitment.PaymentsMade + 1


    commitment.PaymentsRemaining = commitment.NumberOfPayments
      ? payment.Amount > 0 ? commitment.PaymentsRemaining + 1 : commitment.PaymentsRemaining - 1
      : commitment.PaymentsRemaining;

    const updatedCommitment = await commitment.save({ session });

    const recordedOperation = recordDeleteOperation({
      OperationType: "מחיקה", // Operation type in Hebrew (Delete payment)
      Data: payment, // Payment details
      Desc: `מחיקת תשלום מהתחייבות לקמפיין ${commitment.CampainName} בסך ${payment.Amount} ש"ח`,
      Date: new Date(), // Current date and time
      UserFullName: req.user?.FullName // User triggering the operation
    });
    console.log('33');

    // Add the recorded operation to the person's PaymentsOperations array
    await People.updateOne(
      { AnashIdentifier: commitment.AnashIdentifier },
      {
        $push: {
          PaymentsOperations: {
            $each: [recordedOperation],
            $slice: -20, // Limit to the latest 20 operations
          }
        }
      },
      { session }
    );
    if (payment?.PaymentMethod === "מזומן") {
      const paymentInPettyCash = await pettyCash.findOne({ PaymentId: paymentId }).session(session);
      if (paymentInPettyCash) {
        await pettyCash.findOneAndDelete({ PaymentId: paymentId }, { session })
      }
    }
    console.log('44');

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "success",
      deletedPayment,
      updatedCommitment,
    });
  } catch (error) {
    console.error(error);
    // Abort the transaction in case of error
    await session.abortTransaction();
    session.endSession();
    return next(new AppError(500, "Transaction failed: " + error.message));
  }
});


// פונקציה לתרגום שגיאות לעברית

exports.getCommitmentsByCampaign = asyncHandler(async (req, res, next) => {
  const { campainName, isActive } = req.query;
  console.log(req.query);
  console.log(campainName, isActive);

  // Step 1: Build filters for campaign and isActive
  const campainFilter = campainName ? { CampainName: campainName } : {};
  let isActiveFilter = {};

  if (isActive === "true") {
    isActiveFilter.isActive = true;
  } else if (isActive === "false") {
    isActiveFilter.isActive = false;
  }

  // Step 2: Retrieve the list of AnashIdentifiers based on the isActive filter
  let activePeople;
  if (isActive === "true" || isActive === "false") {
    activePeople = await People.find(isActiveFilter).select("AnashIdentifier");
  } else {
    // If no isActive filter, retrieve all AnashIdentifiers
    activePeople = await People.find().select("AnashIdentifier");
  }

  // Step 3: Get a list of AnashIdentifiers from the activePeople result
  const anashIdentifiers = activePeople.map(person => person.AnashIdentifier);

  // Step 4: Query commitments that match the AnashIdentifiers
  const commitments = await commitmentsModel
    .find({
      ...campainFilter,
      AnashIdentifier: { $in: anashIdentifiers } // Filter by AnashIdentifiers
    });

  // Step 5: Return the result
  res.status(200).json({
    status: "success",
    data: {
      commitments,
    },
  });
});






// .select(
//   "AnashIdentifier PersonID FirstName LastName CommitmentAmount AmountPaid AmountRemaining NumberOfPayments PaymentsMade PaymentsRemaining Fundraiser PaymentMethod Notes ResponseToFundraiser"
// );

function getCommitmentOfPayment(payment, commitments) {
  const matchingCommitment = commitments.find(
    commitment => commitment.AnashIdentifier === payment.AnashIdentifier && commitment.CampainName === payment.CampainName
  );
  if (matchingCommitment) {
    payment.CommitmentId = matchingCommitment._id
  }

  return matchingCommitment;
}


















exports.getCommitmentById = asyncHandler(async (req, res, next) => {
  const commitmentId = req.params._id;
  const commitment = await commitmentsModel.findById(commitmentId);
  const payments = await getCommitmentPayments(commitmentId);
  if (!commitment) {
    return next(new AppError("User not found", 404));
  }

  else {
    res.status(200).json({
      status: "success",
      data: {
        commitment,
        payments,
      },
    });
  }
});
async function getCommitmentPayments(commitmentId) {
  try {
    const payments = await paymentModel.find({ CommitmentId: commitmentId });
    return payments;
  }
  catch (err) {
    return null;
  }

}
exports.deleteCommitment = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    console.log('3');


    const commitmentId = req.params.commitmentId;

    // Check if there are payments associated with the commitment
    const commitmentPayments = await paymentModel
      .find({ CommitmentId: commitmentId })
      .session(session);

    if (commitmentPayments?.length > 0) {
      throw new AppError(400, "לא ניתן למחוק התחייבות כי קיימים תשלומים בהתחייבות");
    }

    // Delete commitment
    const deletedCommitment = await commitmentsModel
      .findByIdAndDelete(commitmentId)
      .session(session);

    if (!deletedCommitment) {
      throw new AppError(400, "התחייבות לא נמצאה");
    }
    console.log('4');

    // Delete payments related to the commitment
    const deletedPayments = await paymentModel
      .deleteMany({ CommitmentId: commitmentId })
      .session(session);

    // Find user for logging purposes
    const user = await People.findOne({
      AnashIdentifier: deletedCommitment.AnashIdentifier,
    }).session(session);
    console.log('5');


    if (user) {
      // Prepare record operation
      const recordOperation = recordDeleteOperation({
        Date: new Date(),
        OperationType: "מחיקה",
        UserFullName: req.user?.FullName,
        Data: deletedCommitment,
        Desc: `מחיקת התחייבות מקמפיין ${deletedCommitment.CampainName} סך ההתחייבות בגובה ${deletedCommitment.CommitmentAmount} ש"ח`,
      });
      console.log('6');


      // Save operation record to user
      user.CommitmentsOperations.push(recordOperation);
      await user.save({ session });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();
    console.log('7');

    // Respond with success
    res.status(200).json({
      status: "success",
      message: "Commitment and related payments deleted successfully.",
    });
  } catch (error) {
    // Roll back the transaction
    await session.abortTransaction();
    session.endSession();

    next(error); // Pass the error to the global error handler
  }
});




exports.AddMemorialDayToPerson = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { AnashIdentifier, CampainName, MemorialDay } = req.body;

    // Find commitment
    const commitment = await commitmentsModel
      .findOne({ AnashIdentifier, CampainName })
      .session(session);

    if (!commitment) {
      throw new AppError("Commitment not found", 404);
    }

    // Find campaign
    const campain = await campainModel
      .findOne({ CampainName })
      .session(session);

    if (!campain) {
      throw new AppError("Campaign not found", 404);
    }

    // Check for existing memorial days with the same date
    const campainCommitments = await commitmentsModel
      .find({ CampainName })
      .session(session);

    let commitmentWithTheSameDate = "";
    const isMemorialDayAlreadySet = campainCommitments?.some((commitment) =>
      commitment.MemorialDays?.some((memDay) => {
        if (isTheSameDate(new Date(memDay.date), new Date(MemorialDay.date))) {
          commitmentWithTheSameDate = commitment;
          return true;
        }
        return false;
      })
    );

    if (isMemorialDayAlreadySet) {
      throw new AppError(
        400,
        `יום הנצחה תפוס על ידי ${commitmentWithTheSameDate.FirstName} ${commitmentWithTheSameDate.LastName}`
      );
    }

    // Check if there is enough money for the memorial day
    const isEnoughMoney =
      Math.floor(
        commitment.CommitmentAmount / campain.minimumAmountForMemorialDay
      ) - commitment.MemorialDays.length;

    if (isEnoughMoney <= 0) {
      throw new AppError("Not enough money", 400);
    }

    // Check for existing memorial day in the commitment
    const existingMemorialDayIndex = commitment.MemorialDays.findIndex((md) =>
      isTheSameDate(new Date(md.date), new Date(MemorialDay.date))
    );

    if (existingMemorialDayIndex !== -1) {
      // Override existing memorial day
      commitment.MemorialDays[existingMemorialDayIndex] = MemorialDay;
    } else {
      // Add new memorial day
      commitment.MemorialDays.push(MemorialDay);
    }

    // Save updated commitment
    const updatedCommitment = await commitment.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    // Respond with success
    res.status(200).json({
      status: "success",
      data: {
        updatedCommitment,
      },
    });
  } catch (error) {
    // Roll back the transaction
    await session.abortTransaction();
    session.endSession();

    next(error); // Pass error to the global error handler
  }
});
exports.GetEligblePeopleToMemmorialDay = asyncHandler(
  async (req, res, next) => {
    const { campainName } = req.params;
    const campain = await campainModel.findOne({ CampainName: campainName });
    if (!campain) {
      return next(new AppError("Campain not found", 404));
    }
    const commitments = await commitmentsModel
      .find({ CampainName: campainName })
      .populate("person");

    if (!commitments || commitments.length === 0) {
      return next(new AppError("Commitments not found", 404));
    }
    let people = [];

    commitments.forEach((commitment) => {
      const remainingMemorialDays =
        Math.floor(
          commitment.CommitmentAmount / campain.minimumAmountForMemorialDay
        ) - commitment.MemorialDays.length;
      // If the remainingMemorialDays is enough, add the person associated with the commitment
      if (remainingMemorialDays > 0) {
        people.push(commitment.person); // This is the person associated with the commitment
      }
    });

    res.status(200).json({
      status: "success",
      data: {
        people,
      },
    });
  }
);

exports.DeleteMemorialDay = asyncHandler(async (req, res, next) => {
  const { AnashIdentifier, CampainName, date } = req.query;
  const commitment = await commitmentsModel.findOne({
    AnashIdentifier: AnashIdentifier,
    CampainName: CampainName,
  });
  if (!commitment) {
    return next(new AppError("Commitment not found", 404));
  }
  let updatedMemorialDays = commitment.MemorialDays;
  updatedMemorialDays = commitment.MemorialDays.filter((day) => {
    return !isTheSameDate(new Date(day.date), new Date(date));
  });

  if (updatedMemorialDays.length === commitment.MemorialDays.length) {
    return next(new AppError("Date not found", 404));
  }
  commitment.MemorialDays = updatedMemorialDays;
  const updatedCommitment = await commitment.save();
  res.status(200).json({
    status: "success",
    data: {
      updatedCommitment,
    },
  });
});
function isTheSameDate(date1, date2) {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}


exports.getCommitment = asyncHandler(async (req, res, next) => {
  const commitments = await commitmentsModel.find();

  if (!commitments) {
    return next(new AppError("Commitments not found", 404));
  }
  res.status(200).json({
    status: "success",
    data: {
      commitments,
    },
  });
});